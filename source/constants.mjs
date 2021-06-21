/*
 * Copyright (c) 2020, Institute of Electronics and Computer Science (EDI)
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions
 * are met:
 * 1. Redistributions of source code must retain the above copyright
 *    notice, this list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright
 *    notice, this list of conditions and the following disclaimer in the
 *    documentation and/or other materials provided with the distribution.
 * 3. Neither the name of the Institute nor the names of its contributors
 *    may be used to endorse or promote products derived from this software
 *    without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE INSTITUTE AND CONTRIBUTORS ``AS IS'' AND
 * ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
 * IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
 * ARE DISCLAIMED.  IN NO EVENT SHALL THE INSTITUTE OR CONTRIBUTORS BE LIABLE
 * FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
 * DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS
 * OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION)
 * HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT
 * LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY
 * OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF
 * SUCH DAMAGE.
 */

/**
 * \file
 *         Common constant values.
 * \author
 *         Atis Elsts <atis.elsts@edi.lv>
 */

const constants = {
    /* Contiki-NG cell opptions */
    CELL_OPTION_TX:               1,
    CELL_OPTION_RX:               2,
    CELL_OPTION_SHARED:           4,
    CELL_OPTION_PROBING:         16,
    CELL_OPTION_PROBING_ACK:     32,

    /* 802.15.4e cell types. CELL_TYPE_ADVERTISING_ONLY is an extra one: for EB-only cells. */
    CELL_TYPE_NORMAL:             0,
    CELL_TYPE_ADVERTISING:        1,
    CELL_TYPE_ADVERTISING_ONLY:   2,

    /* Default IEEE 802.15.4e hopping sequences, obtained from https://gist.github.com/twatteyne/2e22ee3c1a802b685695 */
    /* 16 channels, sequence length 16 */
    TSCH_HOPPING_SEQUENCE_16_16: [ 16, 17, 23, 18, 26, 15, 25, 22, 19, 11, 12, 13, 24, 14, 20, 21 ],
    /* 4 channels, sequence length 16 */
    TSCH_HOPPING_SEQUENCE_4_16:  [ 20, 26, 25, 26, 15, 15, 25, 20, 26, 15, 26, 25, 20, 15, 20, 25 ],
    /* 4 channels, sequence length 4 */
    TSCH_HOPPING_SEQUENCE_4_4:   [ 15, 25, 26, 20 ],
    /* 2 channels, sequence length 2 */
    TSCH_HOPPING_SEQUENCE_2_2:   [ 20, 25 ],
    /* 1 channel, sequence length 1 */
    TSCH_HOPPING_SEQUENCE_1_1:   [ 20 ],

    /* From TCP/IP standards */
    PROTO_ICMP:  1,
    PROTO_TCP:   6,
    PROTO_UDP:   17,
    PROTO_ICMP6: 58,

    /* Extension headers */
    PROTO_EXT_HBHO:     0,
    PROTO_EXT_DESTO:   60,
    PROTO_EXT_ROUTING: 43,
    PROTO_EXT_FRAG:    44,
    PROTO_EXT_NONE:    59,

    /* Implementation specific (must be >= 256) */
    PROTO_APP:   256,
    PROTO_TSCH:  257,

    /* From 802.15.4 standard */
    FRAME802154_BEACONFRAME: 0,
    FRAME802154_DATAFRAME:   1,
    FRAME802154_ACKFRAME:    2,
    FRAME802154_CMDFRAME:    3,

    IEEE_ADDR_SIZE: 8,

    /* Special values (ID 0 is reserved) */
    ROOT_NODE_ID: 1, /* Root node ID */
    BROADCAST_ID: -1, /* Broadcast "neighbor" ID */
    EB_ID: -2,  /* EB "neighbor" ID */

    /* Constants relevant to radio propagation */
    TWO_DOT_FOUR_GHZ:   2400000000, /* Hz */
    SPEED_OF_LIGHT:     299792458, /* m/s */

    /* Schedule cell flags for the web interface */
    FLAG_RX:            1 << 0,
    FLAG_TX:            1 << 1,
    FLAG_SKIPPED_TX:    1 << 2,

    FLAG_PACKET_TX:     1 << 3,
    FLAG_PACKET_RX:     1 << 4,
    FLAG_PACKET_BADRX:  1 << 5,

    FLAG_ACK:           1 << 6,
    FLAG_ACK_OK:        1 << 7,

    /* Run speeds for interactive simulations */
    RUN_UNLIMITED:        1,
    RUN_1000_PERCENT:     2,
    RUN_100_PERCENT:      3,
    RUN_10_PERCENT:       4,
    RUN_STEP_NEXT_ACTIVE: 5,
    RUN_STEP_SINGLE:      6,

    /* Query packet statuses */
    PACKET_IS_DATA: 0,
    PACKET_IS_REQUEST: 1,
    PACKET_IS_RESPONSE: 2,
};

export default constants;
