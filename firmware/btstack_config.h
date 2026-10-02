#pragma once

//BTstack configuration for BLE provisioning only: one peripheral connection,
//a GATT server, LE Secure Connections pairing. Derived from the SDK examples'
//btstack_config_common.h, trimmed hard because every buffer here is static
//.bss competing with the FreeRTOS heap and the IrMessage queues.

#ifndef ENABLE_BLE
#error Link pico_btstack_ble
#endif

#define ENABLE_LOG_ERROR
//The SDK always compiles hci_dump_embedded_stdout.c, which requires this.
#define ENABLE_PRINTF_HEXDUMP
#define ENABLE_LE_PERIPHERAL
#define ENABLE_LE_SECURE_CONNECTIONS
#define ENABLE_MICRO_ECC_FOR_LE_SECURE_CONNECTIONS
#define ENABLE_SOFTWARE_AES128

//Buffers. 255 bytes of ACL payload allows an ATT MTU of ~247, enough to write
//any provisioning field in one request; longer values still work via
//prepared writes.
#define HCI_OUTGOING_PRE_BUFFER_SIZE 4
#define HCI_ACL_PAYLOAD_SIZE (255 + 4)
#define HCI_ACL_CHUNK_SIZE_ALIGNMENT 4

#define MAX_NR_HCI_CONNECTIONS 1
#define MAX_NR_L2CAP_CHANNELS 0
#define MAX_NR_L2CAP_SERVICES 0
#define MAX_NR_GATT_CLIENTS 0
#define MAX_NR_SM_LOOKUP_ENTRIES 3
#define MAX_NR_WHITELIST_ENTRIES 1
#define MAX_NR_LE_DEVICE_DB_ENTRIES 1

//Kept from the SDK config: limits ACL buffers and enables controller-to-host
//flow control to avoid overrunning the cyw43 shared bus.
#define MAX_NR_CONTROLLER_ACL_BUFFERS 3
#define ENABLE_HCI_CONTROLLER_TO_HOST_FLOW_CONTROL
#define HCI_HOST_ACL_PACKET_LEN 255
#define HCI_HOST_ACL_PACKET_NUM 3
#define HCI_HOST_SCO_PACKET_LEN 0
#define HCI_HOST_SCO_PACKET_NUM 0

//LE device DB on the TLV in pico_btstack's flash bank. We never bond, but the
//DB must still have at least one entry.
#define NVM_NUM_DEVICE_DB_ENTRIES 1
#define NVM_NUM_LINK_KEYS 1

//No malloc for BTstack, so a fixed-size ATT DB.
#define MAX_ATT_DB_SIZE 512

#define HAVE_EMBEDDED_TIME_MS
#define HAVE_ASSERT
#define HCI_RESET_RESEND_TIMEOUT_MS 1000
