#pragma once


#define LWIP_DEBUG 1
#define MQTT_DEBUG LWIP_DBG_ON
#define TCPIP_DEBUG LWIP_DBG_ON

#define NO_SYS                      0
#define LWIP_SOCKET                 0
#define LWIP_NETCONN                0

#define MEM_ALIGNMENT               4
#define MEM_SIZE                    (32 * 1024)
#define MEMP_NUM_SYS_TIMEOUT            (LWIP_NUM_SYS_TIMEOUT_INTERNAL+1) 
#define MEMP_NUM_TCP_SEG             32
#define MEMP_NUM_ARP_QUEUE            10
#define PBUF_POOL_SIZE                32

#define LWIP_ARP                     1
#define LWIP_ETHERNET                1
#define LWIP_ICMP                    1
#define LWIP_RAW                     1
#define TCP_WND                      (8 * TCP_MSS)
#define TCP_MSS                      1460
#define TCP_SND_BUF                  (8 * TCP_MSS)
#define TCP_SND_QUEUELEN             ((4 * TCP_SND_BUF) / TCP_MSS)

#define LWIP_NETIF_STATUS_CALLBACK   1
#define LWIP_NETIF_LINK_CALLBACK     1
#define LWIP_NETIF_HOSTNAME          1
#define LWIP_NETCONN_SEM_PER_THREAD  0

#define LWIP_DHCP                    1
#define LWIP_DNS                     1
#define LWIP_IPV4                    1
#define LWIP_IPV6                    0
#define LWIP_TCP                     1
#define LWIP_UDP                     1

//MQTT client
#define LWIP_MQTT                    1
#define MQTT_OUTPUT_RINGBUF_SIZE     1024
#define MQTT_VAR_HEADER_BUFFER_LEN   256
#define MQTT_REQ_MAX_IN_FLIGHT       8

//FreeRTOS integration (required by pico_cyw43_arch_lwip_sys_freertos
#define LWIP_TIMEVAL_PRIVATE          0
#define TCPIP_THREAD_STACKSIZE        2048
#define TCPIP_THREAD_PRIO              (configMAX_PRIORITIES - 3)
#define DEFAULT_THREAD_STACKSIZE       2048
#define DEFAULT_RAW_RECVMBOX_SIZE      8
#define TCPIP_MBOX_SIZE                8
#define LWIP_TCPIP_CORE_LOCKING        1

#define LWIP_STATS                    0
#define LWIP_DEBUG                    0

#define LWIP_PLATFORM_ASSERT(x) do { panic("lwip assert: %s", x); } while (0)
