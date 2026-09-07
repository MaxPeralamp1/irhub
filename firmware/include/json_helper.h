#pragma once

#include <cstddef>
#include "config.h"

//Lightweight, dependency-free JSON helpers for the single fixed schema used
//on the wire: {"carrier_freq": 38000, "pulses": [9000, 4500, 560, ...]}
//A full JSON library is overkill for a single, known message shape on a
//memory-constrained MCU, so we hand-roll a tiny encoder/decoder instead.

namespace json_helper {

//Encode an IrMessage into `out` (NUL-terminated). Returns written length,
//or 0 if the buffer was too small.
size_t encode_ir_message(const IrMessage &msg, char *out, size_t out_len);

//Decode a JSON payload of the above schema into `msg`.
//Returns true on success.
bool decode_ir_message(const char *json, size_t json_len, IrMessage &msg);

} //namespace json_helper
