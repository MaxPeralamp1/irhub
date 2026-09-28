#pragma once

#include <cstddef>
#include "config.h"

//Lightweight, dependency-free JSON helpers for the single fixed schema used
//on the wire:
//
//  {"carrier_freq":38000,"frame_count":1,"truncated":false,
//   "pulses":[9000,4500,560,...]}
//
//frame_count and truncated are outbound metadata (irhub/learned): they tell
//the backend whether a capture was clipped or contains more than one frame.
//The inbound direction (irhub/send) only needs carrier_freq and pulses;
//unknown keys are ignored by the decoder.
//
//A full JSON library is overkill for a single, known message shape on a
//memory-constrained MCU, so we hand-roll a tiny encoder/decoder instead.

namespace json_helper {

//Encode an IrMessage into `out` (NUL-terminated). Returns written length,
//or 0 if the buffer was too small.
size_t encode_ir_message(const IrMessage &msg, char *out, size_t out_len);

//Decode a JSON payload of the above schema into `msg`.
//Returns true on success. Sets msg.truncated if the payload carried more
//pulses than IR_MAX_PULSES.
bool decode_ir_message(const char *json, size_t json_len, IrMessage &msg);

} //namespace json_helper
