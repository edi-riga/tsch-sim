const constants = {
    /* Schedule cell flags */
    FLAG_RX:            1 << 0,
    FLAG_TX:            1 << 1,
    FLAG_SKIPPED_TX:    1 << 2,

    FLAG_PACKET_TX:     1 << 3,
    FLAG_PACKET_RX:     1 << 4,
    FLAG_PACKET_BADRX:  1 << 5,

    FLAG_ACK:           1 << 6,
    FLAG_ACK_OK:        1 << 7,

    /* Run speeds */
    RUN_UNLIMITED:        1,
    RUN_1000_PERCENT:     2,
    RUN_100_PERCENT:      3,
    RUN_10_PERCENT:       4,
    RUN_STEP_NEXT_ACTIVE: 5,
    RUN_STEP_SINGLE:      6,
};
