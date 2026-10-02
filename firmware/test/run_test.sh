#!/usr/bin/env bash
# Host-side regression tests. Needs neither hardware nor the ARM toolchain.
#
#   test_capture     ../src/ir_capture.cpp compiled against the stub
#                    FreeRTOS/Pico headers in stubs/, which provide a
#                    controllable clock, so the edge ISR and the idle alarm
#                    can be driven directly with synthetic edge sequences.
#   test_net_config  ../src/net_config.cpp (the provisioned network-config
#                    record), which is pure logic. Built twice: without
#                    build-time defaults, and with them as CMake passes them.
#
# Every suite runs even if an earlier one fails; the exit status is non-zero
# if any failed.
#
#   ./run_test.sh
set -euo pipefail

cd "$(dirname "$0")"

CXX=${CXX:-g++}
failed=0

"$CXX" -std=c++17 -Wall -Wextra -Wno-unused-parameter -g \
    -I stubs -I ../include \
    test_capture.cpp -o test_capture
./test_capture || failed=1

"$CXX" -std=c++17 -Wall -Wextra -g -I ../include \
    test_net_config.cpp ../src/net_config.cpp -o test_net_config
./test_net_config || failed=1

"$CXX" -std=c++17 -Wall -Wextra -g -I ../include -DNET_CONFIG_TEST_DEFAULTS \
    -DWIFI_SSID='"LabNet"' -DWIFI_PASSWORD='"labpassword"' \
    -DMQTT_BROKER_IP='"10.0.0.5"' -DMQTT_BROKER_PORT=1884 \
    test_net_config.cpp ../src/net_config.cpp -o test_net_config_defaults
./test_net_config_defaults || failed=1

exit $failed
