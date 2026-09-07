cmake_minimum_required(VERSION 3.13)

set(CMAKE_C_STANDARD 11)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)


include(pico_sdk_import.cmake)


include(FreeRTOS_Kernel_import.cmake)

project(irhub_firmware C CXX ASM)

set(PICO_BOARD pico_w)

pico_sdk_init()

add_executable(irhub_firmware
    main.cpp
    src/ir_capture.cpp
    src/ir_transmit.cpp
    src/mqtt_manager.cpp
    src/json_helper.cpp
)

target_include_directories(irhub_firmware PRIVATE
    ${CMAKE_CURRENT_LIST_DIR}
    ${CMAKE_CURRENT_LIST_DIR}/include
)

# Wi-Fi credentials / broker config can be overridden at build time:
#   cmake -DWIFI_SSID=... -DWIFI_PASSWORD=... -DMQTT_BROKER_IP=...
set(WIFI_SSID "YOUR_WIFI_SSID" CACHE STRING "Wi-Fi SSID")
set(WIFI_PASSWORD "YOUR_WIFI_PASSWORD" CACHE STRING "Wi-Fi password")
set(MQTT_BROKER_IP "192.168.1.100" CACHE STRING "Mosquitto broker IP")
set(MQTT_BROKER_PORT "1883" CACHE STRING "Mosquitto broker port")

target_compile_definitions(irhub_firmware PRIVATE
    WIFI_SSID="${WIFI_SSID}"
    WIFI_PASSWORD="${WIFI_PASSWORD}"
    MQTT_BROKER_IP="${MQTT_BROKER_IP}"
    MQTT_BROKER_PORT=${MQTT_BROKER_PORT}
    CYW43_HOST_NAME="irhub-pico"
    PICO_MALLOC_PANIC=1
    CYW43_TASK_STACK_SIZE=4096
)

target_link_libraries(irhub_firmware
    pico_stdlib
    pico_cyw43_arch_lwip_sys_freertos
    pico_lwip_mqtt
    hardware_pio
    hardware_pwm
    hardware_timer
    hardware_gpio
    hardware_clocks
    hardware_irq
    FreeRTOS-Kernel-Heap4
)

pico_enable_stdio_usb(irhub_firmware 1)
pico_enable_stdio_uart(irhub_firmware 0)

pico_add_extra_outputs(irhub_firmware)
