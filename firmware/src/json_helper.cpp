#include "json_helper.h"
#include <cstdio>
#include <cstdlib>
#include <cstring>

namespace json_helper {

size_t encode_ir_message(const IrMessage &msg, char *out, size_t out_len) {
    size_t pos = 0;
    int n = snprintf(out + pos, out_len - pos,
                      "{\"carrier_freq\":%lu,\"frame_count\":%u,\"truncated\":%s,\"pulses\":[",
                      (unsigned long)msg.carrier_freq,
                      (unsigned)msg.frame_count,
                      msg.truncated ? "true" : "false");
    if (n < 0 || (size_t)n >= out_len - pos) return 0;
    pos += n;

    for (uint16_t i = 0; i < msg.pulse_count; i++) {
        n = snprintf(out + pos, out_len - pos, "%s%u",
                      (i == 0) ? "" : ",", msg.pulses[i]);
        if (n < 0 || (size_t)n >= out_len - pos) return 0;
        pos += n;
    }

    n = snprintf(out + pos, out_len - pos, "]}");
    if (n < 0 || (size_t)n >= out_len - pos) return 0;
    pos += n;

    return pos;
}

//Very small hand-rolled parser for the fixed schema. Tolerant of whitespace
//and of unknown keys, so a payload carrying frame_count/truncated parses
//fine even though the transmit path has no use for them.
bool decode_ir_message(const char *json, size_t json_len, IrMessage &msg) {
    msg.carrier_freq = IR_CARRIER_HZ;
    msg.pulse_count = 0;
    //Defaults for the inbound direction: /api/send sends only carrier_freq and
    //pulses, and neither field means anything when transmitting. They are
    //initialised regardless so the struct never carries stack garbage onto
    //the transmit queue.
    msg.frame_count = 1;
    msg.truncated = false;

    const char *cf = strstr(json, "\"carrier_freq\"");
    if (cf) {
        const char *colon = strchr(cf, ':');
        if (colon) msg.carrier_freq = (uint32_t)strtoul(colon + 1, nullptr, 10);
    }

    const char *arr = strstr(json, "\"pulses\"");
    if (!arr) return false;
    const char *bracket = strchr(arr, '[');
    if (!bracket) return false;

    const char *p = bracket + 1;
    const char *end = json + json_len;
    uint16_t count = 0;

    while (p < end && *p != ']' && count < IR_MAX_PULSES) {
        //skip whitespace / commas
        while (p < end && (*p == ' ' || *p == ',' || *p == '\n' || *p == '\t')) p++;
        if (p >= end || *p == ']') break;

        char *next = nullptr;
        long val = strtol(p, &next, 10);
        if (next == p) break; //no digits parsed, malformed
        msg.pulses[count++] = (uint16_t)val;
        p = next;
    }

    msg.pulse_count = count;

    //If the sender had more pulses than we can hold, say so rather than
    //transmitting a half command.
    if (count >= IR_MAX_PULSES) {
        while (p < end && *p != ']') {
            if (*p >= '0' && *p <= '9') { msg.truncated = true; break; }
            p++;
        }
    }

    return count > 0;
}

} //namespace json_helper
