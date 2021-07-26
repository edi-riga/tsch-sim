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
 *         Network packet
 * \author
 *         Atis Elsts <atis.elsts@edi.lv>
 */

import constants from './constants.mjs';
import * as time from './time.mjs';
import { id_to_addr } from './utils.mjs';

/* ------------------------------------- */

export class RxInfo {
    constructor(rssi) {
        /* RSSI of the reception */
        this.rssi = rssi;
        /* Has the packet been received OK, without any errors? */
        this.is_success = false;
    }
}

/* ------------------------------------- */

export class FragmentInfo {
    constructor(tag) {
        this.tag = tag;
        this.number = -1;
        this.total_fragments = 0;
    }
}

/* ------------------------------------- */

/* Network packet */
export class Packet {

    constructor(source, destination_id, length, is_on_link=false) {
        this.source = source; /* end-to-end: originator */
        this.destination_id = destination_id; /* end-to-end: destination */
        this.length = length;
        this.seqnum = -1; /* end-to-end sequence number */
        this.link_layer_seqnum = -1; /* link layer sequence number */
        this.packetbuf = {}; /* attributes for TSCH and other protocol layers */
        this.packetbuf.PACKETBUF_ATTR_FRAME_TYPE = constants.FRAME802154_DATAFRAME; 
        this.subslot = 0; /* some TSCH slots may have multiple subslots */
        // The value of is on link is defaulted to false in the function header
        if (is_on_link) {
            this.nexthop_id = destination_id;
        } else {
            this.nexthop_id = source.routes.get_nexthop(destination_id); /* link-layer: destination */
        }
        if (this.nexthop_id <= 0) {
            /* nexthop not found, or broadcast */
            this.nexthop_addr = null;
        } else {
            this.nexthop_addr = id_to_addr(this.nexthop_id);
        }
        this.lasthop_id = source.id; /* link-layer: source */
        this.lasthop_addr = source.addr; /* link-layer: source */
        this.num_transmissions = 0;
        this.is_ack_required = (this.nexthop_id > 0);
        this.generation_time_s = time.timeline.seconds;
        this.packet_protocol = -1;
        this.msg_type = 0;
        this.query_status = constants.PACKET_IS_DATA;
        /* 6LoWPAN fragmentation */
        this.fragment_info = null;
        /* function called when the packet is completed sending (ACKed or dropped) */
        this.sent_callback = null;
        /* updated on each Tx attempt */
        this.reserved_bit_set = false;
        this.hopcount = 0;
        this.tx_channel = null;
        /* updated on each Tx attempt for each receiver */
        this.rx_info = {};
    }

    // Copy all attributes of a packet to another packet object
    copy(other) {
        this.source = other.source;
        this.destination_id = other.destination_id;
        this.length = other.length;
        this.seqnum = other.seqnum;
        this.link_layer_seqnum = other.link_layer_seqnum;
        this.packetbuf = JSON.parse(JSON.stringify(other.packetbuf));
        this.subslot = other.subslot;
        this.num_transmissions = 0;
        this.lasthop_id = other.lasthop_id;
        this.lasthop_addr = JSON.parse(JSON.stringify(other.lasthop_addr));
        this.nexthop_id = other.nexthop_id;
        this.nexthop_addr = JSON.parse(JSON.stringify(other.nexthop_addr));
        this.is_ack_required = other.is_ack_required;
        this.generation_time_s = other.generation_time_s;
        this.packet_protocol = other.packet_protocol;
        this.msg_type = other.msg_type;
        this.query_status = other.query_status;
        this.fragment_info = other.fragment_info;
        this.sent_callback = other.sent_callback;
        this.reserved_bit_set = false;
        this.hopcount = other.hopcount;
        this.rx_info = {};
    }
}
