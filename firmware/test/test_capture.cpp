// Host-side simulation of the IR capture path.
//
// The real ir_capture.cpp is #included so that the file-static ISR and timer
// callback can be driven directly. Time comes from a fake clock, and the
// harness steps it in <=2ms increments while calling idle_timeout_cb, exactly
// modelling the 2ms repeating alarm on the Pico.

#include <cstdint>
#include <cstdio>
#include <string>
#include <vector>

uint64_t g_sim_now_us = 1000000;  // referenced by the pico/time.h stub

#include "../src/ir_capture.cpp"

QueueHandle_t g_captureToMqttQueue = nullptr;
QueueHandle_t g_mqttToTransmitQueue = nullptr;
SemaphoreHandle_t g_mqttPublishMutex = nullptr;

// ---------------------------------------------------------------- harness

static int g_pass = 0, g_fail = 0;

static void check(bool cond, const std::string &what) {
    printf(cond ? "  PASS  %s\n" : "  FAIL  %s\n", what.c_str());
    cond ? g_pass++ : g_fail++;
}

template <typename T>
static void check_eq(T got, T want, const std::string &what) {
    char buf[256];
    snprintf(buf, sizeof(buf), "%s (got %lld, want %lld)", what.c_str(),
             (long long)got, (long long)want);
    check(got == want, buf);
}

// Advance the simulated clock by exactly `us`, running the 2ms idle alarm on
// the way, so end-of-capture is detected at the same point it would be on
// hardware.
static void advance_us(uint64_t us) {
    while (us > 0) {
        uint64_t step = us > 2000 ? 2000 : us;
        g_sim_now_us += step;
        us -= step;
        ir_capture::idle_timeout_cb(nullptr);
    }
}

// Wait `gap` microseconds, then deliver an edge. The value the ISR records
// for this edge is `gap` (the interval that just ended).
static void edge_after(uint64_t gap) {
    advance_us(gap);
    ir_capture::gpio_edge_isr(IR_RX_PIN, 0);
}

// The first edge of a transmission: starts the capture, records nothing.
static void first_edge() {
    ir_capture::gpio_edge_isr(IR_RX_PIN, 0);
}

// Run the real task body until it would block, collecting everything it
// pushed onto g_captureToMqttQueue.
static std::vector<IrMessage> drain_task() {
    ir_capture::s_ready_queue->throw_when_empty = true;
    try {
        ir_capture::task(nullptr);
    } catch (TestQueueEmpty &) {
    }
    ir_capture::s_ready_queue->throw_when_empty = false;

    std::vector<IrMessage> out;
    IrMessage m;
    while (xQueueReceive(g_captureToMqttQueue, &m, 0) == pdTRUE) out.push_back(m);
    return out;
}

static void reset_all() {
    delete ir_capture::s_ready_queue;
    delete g_captureToMqttQueue;
    ir_capture::s_ready_queue = nullptr;
    ir_capture::s_active_buf = 0;
    ir_capture::s_state = ir_capture::ST_IDLE;
    ir_capture::s_dropped = 0;
    g_captureToMqttQueue = xQueueCreate(4, sizeof(IrMessage));
    ir_capture::init();
    g_sim_now_us += 1000000;
    ir_capture::s_last_edge_us = g_sim_now_us;
}

// A 67-interval NEC frame: 9ms mark, 4.5ms space, 32 bits, final mark.
static std::vector<uint32_t> nec_frame(uint32_t data) {
    std::vector<uint32_t> v{9000, 4500};
    for (int i = 0; i < 32; i++) {
        v.push_back(560);
        v.push_back((data >> i) & 1 ? 1690 : 560);
    }
    v.push_back(560);
    return v;
}

static void send_intervals(const std::vector<uint32_t> &iv) {
    first_edge();
    for (uint32_t t : iv) edge_after(t);
}

// ------------------------------------------------------------------ tests

static void test_single_nec_frame() {
    printf("\n[1] a single NEC frame\n");
    reset_all();
    auto iv = nec_frame(0x20DF10EF);
    send_intervals(iv);
    advance_us(60000);

    auto msgs = drain_task();
    check_eq<int>(msgs.size(), 1, "one capture delivered");
    if (msgs.empty()) return;
    check_eq<int>(msgs[0].pulse_count, (int)iv.size(), "pulse_count");
    check_eq<int>(msgs[0].frame_count, 1, "frame_count");
    check(!msgs[0].truncated, "not marked truncated");
    check_eq<int>(msgs[0].pulses[0], 9000, "pulses[0] is the 9ms header mark");
    check_eq<int>(msgs[0].pulses[1], 4500, "pulses[1] is the 4.5ms header space");
    bool exact = true;
    for (size_t i = 0; i < iv.size(); i++)
        if (msgs[0].pulses[i] != iv[i]) exact = false;
    check(exact, "every interval reproduced exactly");
}

static void test_ac_two_halves() {
    printf("\n[2] an A/C command sent as two halves 30ms apart\n");
    reset_all();
    std::vector<uint32_t> half{3400, 1700, 450, 1250, 450, 420, 450, 1250, 450};
    first_edge();
    for (uint32_t t : half) edge_after(t);
    edge_after(30000);                       // inter-frame gap
    for (uint32_t t : half) edge_after(t);
    advance_us(60000);

    auto msgs = drain_task();
    check_eq<int>(msgs.size(), 1, "both halves arrive as ONE capture");
    if (msgs.empty()) return;
    check_eq<int>(msgs[0].pulse_count, (int)(half.size() * 2 + 1),
                  "pulse_count spans both halves plus the gap");
    check_eq<int>(msgs[0].frame_count, 2, "frame_count reports 2 frames");
    check_eq<int>(msgs[0].pulses[half.size()], 30000,
                  "the 30ms gap is recorded as an ordinary space");
    check(!msgs[0].truncated, "not marked truncated");
}

static void test_nec_repeat_stays_separate() {
    printf("\n[3] NEC auto-repeat 110ms later stays a separate capture\n");
    reset_all();
    auto iv = nec_frame(0x20DF10EF);
    send_intervals(iv);
    advance_us(110000);                      // > IR_MESSAGE_GAP_US
    send_intervals({9000, 2250, 560});       // NEC repeat burst
    advance_us(60000);

    auto msgs = drain_task();
    check_eq<int>(msgs.size(), 2, "two separate captures");
    if (msgs.size() < 2) return;
    check_eq<int>(msgs[0].frame_count, 1, "first capture is one frame");
    check_eq<int>(msgs[0].pulse_count, (int)iv.size(), "first capture is the full frame");
    check_eq<int>(msgs[1].pulse_count, 3, "second capture is the repeat burst");
}

static void test_glitch_absorbed() {
    printf("\n[4] a noise spike must not shorten the following pulse\n");
    reset_all();
    first_edge();
    edge_after(560);          // a real mark
    advance_us(30);           // spurious edge 30us later (< IR_MIN_PULSE_US)
    ir_capture::gpio_edge_isr(IR_RX_PIN, 0);
    edge_after(1660);         // the real edge, 1690us after the last VALID edge
    advance_us(60000);

    auto msgs = drain_task();
    check_eq<int>(msgs.size(), 1, "one capture delivered");
    if (msgs.empty()) return;
    check_eq<int>(msgs[0].pulse_count, 2, "the glitch did not add a pulse");
    check_eq<int>(msgs[0].pulses[0], 560, "the mark before the glitch is intact");
    check_eq<int>(msgs[0].pulses[1], 1690,
                  "the pulse after the glitch measures from the last valid edge");
}

static void test_truncation_is_flagged() {
    printf("\n[5] an over-length signal is flagged, not silently clipped\n");
    reset_all();
    first_edge();
    for (int i = 0; i < IR_MAX_PULSES + 100; i++) edge_after(500);
    advance_us(60000);

    auto msgs = drain_task();
    check_eq<int>(msgs.size(), 1, "one capture delivered");
    if (msgs.empty()) return;
    check_eq<int>(msgs[0].pulse_count, IR_MAX_PULSES, "pulse_count caps at IR_MAX_PULSES");
    check(msgs[0].truncated, "truncated flag is SET");
}

static void test_no_frames_lost() {
    printf("\n[6] three frames complete before the task runs - none lost\n");
    reset_all();
    // Three distinguishable frames, each ended by its own message gap, with
    // the task never scheduled in between. The old binary-semaphore handoff
    // delivered only the last one.
    send_intervals({1000, 1001, 1002});
    advance_us(60000);
    send_intervals({2000, 2001, 2002, 2003});
    advance_us(60000);
    send_intervals({3000, 3001, 3002, 3003, 3004});
    advance_us(60000);

    auto msgs = drain_task();
    check_eq<int>(msgs.size(), 3, "all three captures delivered");
    if (msgs.size() < 3) return;
    check_eq<int>(msgs[0].pulse_count, 3, "first capture intact");
    check_eq<int>(msgs[1].pulse_count, 4, "second capture intact");
    check_eq<int>(msgs[2].pulse_count, 5, "third capture intact");
    check_eq<int>(msgs[0].pulses[0], 1000, "first capture has its own data");
    check_eq<int>(msgs[1].pulses[0], 2000, "second capture has its own data");
    check_eq<int>(msgs[2].pulses[0], 3000, "third capture has its own data");
    check_eq<int>((int)ir_capture::s_dropped, 0, "nothing dropped");
}

static void test_drop_rather_than_corrupt() {
    printf("\n[7] with every buffer in flight, drop rather than corrupt\n");
    reset_all();
    // Pin every buffer except the active one, as if the task were stalled.
    for (int i = 1; i < IR_CAPTURE_BUFFERS; i++) ir_capture::s_busy[i] = true;

    send_intervals({1000, 1001, 1002});
    advance_us(60000);                       // this one still has a home
    send_intervals({2000, 2001, 2002});
    advance_us(60000);                       // nowhere to go -> dropped

    check_eq<int>((int)ir_capture::s_dropped, 1, "exactly one capture dropped");
    for (int i = 1; i < IR_CAPTURE_BUFFERS; i++) ir_capture::s_busy[i] = false;

    auto msgs = drain_task();
    check_eq<int>(msgs.size(), 1, "the surviving capture is delivered");
    if (msgs.empty()) return;
    check_eq<int>(msgs[0].pulses[0], 1000, "and it is uncorrupted");
}

int main() {
    printf("IR capture simulation (IR_MAX_PULSES=%d, frame gap=%dus, message gap=%dus)\n",
           IR_MAX_PULSES, IR_FRAME_GAP_US, IR_MESSAGE_GAP_US);

    test_single_nec_frame();
    test_ac_two_halves();
    test_nec_repeat_stays_separate();
    test_glitch_absorbed();
    test_truncation_is_flagged();
    test_no_frames_lost();
    test_drop_rather_than_corrupt();

    printf("\n%d passed, %d failed\n", g_pass, g_fail);
    return g_fail ? 1 : 0;
}
