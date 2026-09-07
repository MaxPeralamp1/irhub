# This is a copy of <FREERTOS_KERNEL_PATH>/portable/ThirdParty/GCC/RP2040/FreeRTOS_Kernel_import.cmake
# It pulls in the FreeRTOS kernel with the RP2040 SMP/non-SMP port pre-wired for the Pico SDK.

if(DEFINED ENV{FREERTOS_KERNEL_PATH} AND (NOT FREERTOS_KERNEL_PATH))
    set(FREERTOS_KERNEL_PATH $ENV{FREERTOS_KERNEL_PATH})
    message("Using FREERTOS_KERNEL_PATH from environment ('${FREERTOS_KERNEL_PATH}')")
endif()

set(FREERTOS_KERNEL_PATH "${FREERTOS_KERNEL_PATH}" CACHE PATH "Path to the FreeRTOS Kernel")

if(NOT FREERTOS_KERNEL_PATH)
    message(FATAL_ERROR "FREERTOS_KERNEL_PATH is not set. Clone https://github.com/FreeRTOS/FreeRTOS-Kernel "
                         "and set env var FREERTOS_KERNEL_PATH or pass -DFREERTOS_KERNEL_PATH=...")
endif()

include(${FREERTOS_KERNEL_PATH}/portable/ThirdParty/GCC/RP2040/FreeRTOS_Kernel_import.cmake)
