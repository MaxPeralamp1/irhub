#!/usr/bin/env bash
# Host-side regression test for the IR capture path.
#
# Compiles ../src/ir_capture.cpp for the host against the stub FreeRTOS/Pico
# headers in stubs/, which provide a controllable clock, so the edge ISR and
# the idle alarm can be driven directly with synthetic edge sequences.
# Needs neither hardware nor the ARM toolchain.
#
#   ./run_test.sh
set -euo pipefail

cd "$(dirname "$0")"

CXX=${CXX:-g++}
"$CXX" -std=c++17 -Wall -Wextra -Wno-unused-parameter -g \
    -I stubs -I ../include \
    test_capture.cpp -o test_capture

./test_capture
