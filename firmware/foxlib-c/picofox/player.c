/* SPDX-License-Identifier: GPL-3.0-or-later
 * player.c -- see player.h. */
#include "player.h"
#include <string.h>
#include "hardware/gpio.h"
#include "hardware/i2c.h"
#include "hardware/sync.h"
#include "pico/flash.h"
#include "pico/multicore.h"
#include "pico/time.h"
#include "si5351.h"

/* Commands travel through a mailbox in RAM, not the inter-core FIFO: the SDK's multicore
 * lockout (used by flash_safe_execute while the host writes the drive) owns the FIFO. */
static volatile struct { uint32_t seq, cmd, arg, ack_seq, result; } mbox;
static uint32_t handled_seq;
static inline bool mbox_pending(void) { return mbox.seq != handled_seq; }

enum { CMD_SETUP = 1, CMD_CARRIER, CMD_KEY, CMD_UNKEY, CMD_ATTEN, CMD_PLAY, CMD_STOP, CMD_STATUS, CMD_CORRECTION };
enum { RESP_OK = 0x100, RESP_FAIL };

#define I2C_HZ 1000000   /* a 6-byte fraction write must fit in a 125 us sample period */

static volatile player_status_t st;
static volatile play_req_t *volatile cur;   /* the pointer itself is shared across cores: core 0 spins on it in player_stop */
static volatile uint32_t keyed_at_ms;
static volatile bool core1_ready;
static volatile bool hold_req, held;        /* core 0 asks the FM loop to step off the bus; core 1 says it has */
static volatile bool dead;                  /* core 1 missed a deadline: never wait on it again */

#define CALL_TIMEOUT_US 1000000             /* a command is acknowledged within one sample period; this is 8000x that */
#define STOP_TIMEOUT_US 200000
#define HOLD_TIMEOUT_US 5000

/* ---------------- core 1 side ---------------- */

static void amp_enable(bool on) { gpio_put(PICOFOX_PIN_AMP_EN, on ? 0 : 1); }   /* AEN active low (to confirm on the bench) */

/* BVA1761 serial attenuator interface. UNVERIFIED against the datasheet's timing diagram:
 * 8-bit word, MSB first, attenuation code in 0.25 dB steps, clocked on the rising edge of
 * CLK with LE low, latched by an LE pulse; address 0 (strapped). The I2C peripheral is
 * released for the duration (SCL held low first so the Si5351 never sees a START). */
static void atten_write(int code) {
    if (code < 0) code = 0;
    if (code > 127) code = 127;
    gpio_set_function(PICOFOX_PIN_SCL, GPIO_FUNC_SIO); gpio_set_function(PICOFOX_PIN_SDA, GPIO_FUNC_SIO);
    gpio_set_dir(PICOFOX_PIN_SCL, true); gpio_set_dir(PICOFOX_PIN_SDA, true);
    gpio_put(PICOFOX_PIN_SCL, 0); gpio_put(PICOFOX_PIN_ATTN_LE, 0); busy_wait_us(2);
    gpio_put(PICOFOX_PIN_SDA, 0); busy_wait_us(2);
    uint16_t word = (uint16_t)(code << 1);     /* 8 bits: D7..D1 = code, D0 = 0 */
    for (int i = 7; i >= 0; i--) {
        gpio_put(PICOFOX_PIN_SDA, (word >> i) & 1); busy_wait_us(2);
        gpio_put(PICOFOX_PIN_SCL, 1); busy_wait_us(2);
        gpio_put(PICOFOX_PIN_SCL, 0); busy_wait_us(2);
    }
    gpio_put(PICOFOX_PIN_ATTN_LE, 1); busy_wait_us(2); gpio_put(PICOFOX_PIN_ATTN_LE, 0);
    gpio_put(PICOFOX_PIN_SDA, 1); gpio_put(PICOFOX_PIN_SCL, 1); busy_wait_us(2);
    gpio_set_function(PICOFOX_PIN_SDA, GPIO_FUNC_I2C); gpio_set_function(PICOFOX_PIN_SCL, GPIO_FUNC_I2C);
    st.attenuation = code;
}

static void core1_setup(void) {
    /* amp enable: drive the latch high (off) before the pin becomes an output -- gpio_init leaves it at 0 (= on) */
    gpio_init(PICOFOX_PIN_AMP_EN); amp_enable(false); gpio_set_dir(PICOFOX_PIN_AMP_EN, true);
    gpio_init(PICOFOX_PIN_ATTN_LE); gpio_set_dir(PICOFOX_PIN_ATTN_LE, true); gpio_put(PICOFOX_PIN_ATTN_LE, 0);
    const uint ids[] = { PICOFOX_PIN_ID0, PICOFOX_PIN_ID1, PICOFOX_PIN_ID2, PICOFOX_PIN_ID3 };
    for (int i = 0; i < 4; i++) { gpio_init(ids[i]); gpio_set_dir(ids[i], false); gpio_pull_down(ids[i]); }
    gpio_init(PICOFOX_PIN_CHG_SENSE); gpio_set_dir(PICOFOX_PIN_CHG_SENSE, false); gpio_pull_up(PICOFOX_PIN_CHG_SENSE);
    sleep_ms(2);
    st.revision = gpio_get(PICOFOX_PIN_ID0) ? 3 : 2;
    si5351_bus_clear(PICOFOX_PIN_SDA, PICOFOX_PIN_SCL);   /* a reset mid-transfer can leave the Si5351 holding SDA */
    i2c_init(i2c0, I2C_HZ);
    gpio_set_function(PICOFOX_PIN_SDA, GPIO_FUNC_I2C); gpio_set_function(PICOFOX_PIN_SCL, GPIO_FUNC_I2C);
    st.si5351_ok = si5351_init(i2c0, 25e6, PICOFOX_PIN_SDA, PICOFOX_PIN_SCL);
    st.keyed = false; st.carrier_hz = 0; st.attenuation = 0; st.core1_alive = true;
}

static void key(bool on) {
    if (on) { si5351_set_offset(0); si5351_output(true); amp_enable(true); keyed_at_ms = to_ms_since_boot(get_absolute_time()); }
    else { amp_enable(false); si5351_output(false); si5351_set_offset(0); keyed_at_ms = 0; }
    st.keyed = on;
}

static void play_loop(volatile play_req_t *req) {
    synth_t s;
    if (req->src) synth_prepare_src(&s, req->src, req->src_ctx, (const synth_params_t *)&req->params, req->f_top, req->total_ms);
    else synth_prepare(&s, req->ev, (const synth_params_t *)&req->params);
    uint64_t period = 1000000ull / (uint64_t)req->params.sample_rate;
    uint64_t deadline = time_us_64();
    uint32_t n = 0;
    /* measure one write for the console */
    { uint64_t t0 = time_us_64(); si5351_set_offset(1); si5351_set_offset(0); st.i2c_write_us = (uint32_t)((time_us_64() - t0) / 2); }
    while (!synth_done(&s)) {
        if (mbox_pending()) {
            /* only STOP is meaningful mid-stream; anything else is refused (core 0 stops first) */
            uint32_t c = mbox.cmd; handled_seq = mbox.seq; mbox.result = c == CMD_STOP ? RESP_OK : RESP_FAIL; __dmb(); mbox.ack_seq = handled_seq;
            if (c == CMD_STOP) { req->cut = true; break; }
        }
        if (req->max_samples && n >= req->max_samples) { req->cut = true; break; }
        if (hold_req) {                 /* core 0 is about to write flash: wait here, off the bus, until it is done */
            held = true; while (hold_req) tight_loop_contents(); held = false;
            deadline = time_us_64(); req->late++;
        }
        int16_t smp = synth_next(&s);
        int32_t counts = (int32_t)(((int64_t)smp * req->dev_counts) >> 15);
        deadline += period;
        uint64_t now = time_us_64();
        if (now > deadline + period) { req->late++; deadline = now; }   /* parked by a flash write: resync instead of bursting */
        while (time_us_64() < deadline) tight_loop_contents();
        si5351_set_offset(counts);
        n++; req->played = n;
    }
    si5351_set_offset(0);
    st.i2c_errors = si5351_bus_errors();
    req->done = true;
}

static void core1_main(void) {
    flash_safe_execute_core_init();
    core1_setup();
    core1_ready = true;
    for (;;) {
        while (!mbox_pending()) tight_loop_contents();
        uint32_t cmd = mbox.cmd, arg = mbox.arg, result = RESP_OK;
        volatile play_req_t *req = NULL;
        switch (cmd) {
            case CMD_CARRIER: { bool ok = si5351_set_carrier((double)arg); if (ok) st.carrier_hz = si5351_carrier_hz(); result = ok ? RESP_OK : RESP_FAIL; break; }
            case CMD_KEY: key(true); break;
            case CMD_UNKEY: key(false); break;
            case CMD_SETUP:   /* F14: the Si5351 was probed once at boot; a TCXO/LDO still ramping then answers now */
                if (!st.si5351_ok) { si5351_bus_clear(PICOFOX_PIN_SDA, PICOFOX_PIN_SCL); i2c_init(i2c0, I2C_HZ); gpio_set_function(PICOFOX_PIN_SDA, GPIO_FUNC_I2C); gpio_set_function(PICOFOX_PIN_SCL, GPIO_FUNC_I2C); st.si5351_ok = si5351_init(i2c0, 25e6, PICOFOX_PIN_SDA, PICOFOX_PIN_SCL); }
                result = st.si5351_ok ? RESP_OK : RESP_FAIL; break;
            case CMD_ATTEN: if (st.revision >= 3) atten_write((int)arg); else result = RESP_FAIL; break;
            case CMD_CORRECTION: si5351_set_correction_ppm((int32_t)arg / 1000.0); st.correction_ppm = (float)si5351_correction_ppm(); break;
            case CMD_PLAY: req = (volatile play_req_t *)arg; cur = req; break;
            case CMD_STOP: break;
            default: result = RESP_FAIL; break;
        }
        handled_seq = mbox.seq; mbox.result = result; __dmb(); mbox.ack_seq = handled_seq;
        if (req) { play_loop(req); cur = NULL; }
    }
}

/* ---------------- core 0 side ---------------- */

/* Core 1 stopped answering: the transmitter must not depend on it. The amplifier enable is a GPIO,
 * so core 0 switches it off itself; the Si5351 output stays as it was until the next reboot
 * (si5351_init disables it first thing), which the watchdog brings about if core 1 is hung. */
void player_emergency_unkey(void) { gpio_put(PICOFOX_PIN_AMP_EN, 1); st.keyed = false; keyed_at_ms = 0; }
static void core1_lost(void) { if (!dead) { dead = true; st.core1_alive = false; player_emergency_unkey(); } }
bool player_alive(void) { return !dead; }

static uint32_t call1(uint32_t cmd, uint32_t arg) {
    if (dead) return RESP_FAIL;
    uint32_t seq = mbox.seq + 1;
    mbox.cmd = cmd; mbox.arg = arg; __dmb(); mbox.seq = seq;
    uint64_t t0 = time_us_64();
    while (mbox.ack_seq != seq) { if (time_us_64() - t0 > CALL_TIMEOUT_US) { core1_lost(); return RESP_FAIL; } tight_loop_contents(); }
    __dmb();
    return mbox.result;
}
static uint32_t call(uint32_t cmd) { return call1(cmd, 0); }

void player_start(void) {
    multicore_launch_core1(core1_main);
    while (!core1_ready) tight_loop_contents();
}

bool player_set_carrier(double hz) { if (player_busy()) player_stop(); return call1(CMD_CARRIER, (uint32_t)(hz + 0.5)) == RESP_OK; }
void player_key(bool on) { if (!on && player_busy()) player_stop(); call(on ? CMD_KEY : CMD_UNKEY); }
bool player_set_attenuation(int code) { return call1(CMD_ATTEN, (uint32_t)code) == RESP_OK; }   /* false: mid-stream (core 1 refuses), rev 2, or core 1 dead */
bool player_reprobe(void) { if (player_busy()) return st.si5351_ok; return call(CMD_SETUP) == RESP_OK; }
void player_set_correction_ppm(double ppm) { if (player_busy()) player_stop(); call1(CMD_CORRECTION, (uint32_t)(int32_t)(ppm * 1000.0)); }

void player_play(play_req_t *req) {
    req->done = false; req->cut = false; req->played = 0; req->late = 0;
    if (player_busy()) player_stop();
    if (!req->src && (!req->ev || req->ev->n == 0)) { req->done = true; return; }
    call1(CMD_PLAY, (uint32_t)req);
}

void player_stop(void) {
    if (!cur || dead) return;
    if (call(CMD_STOP) != RESP_OK && dead) return;
    uint64_t t0 = time_us_64();
    while (cur) { if (time_us_64() - t0 > STOP_TIMEOUT_US) { core1_lost(); return; } tight_loop_contents(); }   /* core 1 clears it when play_loop has returned */
    __dmb();
}

/* Flash writes park core 1 wherever it is (flash_safe_execute). Parked inside an I2C write, the SDK's
 * timeout then abandons the transfer without a STOP (si5351.c recovers, but at the cost of a bad
 * sample and a full register rewrite). So before each flash write core 0 asks the FM loop to wait
 * between two samples; an idle core 1 is not on the bus anyway. */
void player_bus_hold(void) {
    if (dead || !cur) return;
    hold_req = true;
    uint64_t t0 = time_us_64();
    while (!held && cur && time_us_64() - t0 < HOLD_TIMEOUT_US) tight_loop_contents();
}
void player_bus_release(void) { hold_req = false; }

bool player_busy(void) { return cur != NULL; }

void player_status(player_status_t *out) { memcpy(out, (const void *)&st, sizeof *out); }
uint32_t player_keyed_ms(void) { return keyed_at_ms ? to_ms_since_boot(get_absolute_time()) - keyed_at_ms : 0; }
bool player_charging(void) { return !gpio_get(PICOFOX_PIN_CHG_SENSE); }
