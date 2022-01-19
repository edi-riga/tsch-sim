/*
 * Copyright (c) 2021, Institute of Electronics and Computer Science (EDI)
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
 *         Packet collision analyzer
 * \author
 *         Atis Elsts <atis.elsts@edi.lv>
 */

import constants from './constants.mjs';

/*---------------------------------------------------------------------------*/

export const PACKET_RX_OK = 0;
export const PACKET_RX_COLLISION = 1;
export const PACKET_RX_LINK_FAILED = 2;
export const PACKET_RX_WRONG_ADDRESS = 3;

const PACKET_TYPE_TSCH = 0; /* EB and keepalive packets */
const PACKET_TYPE_RPL = 1; /* RPL protocol packets: DIO, DIS, DAO, DAO ACK */
const PACKET_TYPE_OTHER = 2; /* incldudes application data packets */

const PACKET_DESTINATION_BC = 0; /* broadcast */
const PACKET_DESTINATION_UC = 1; /* unicast */

function get_name(packet_type, packet_dst)
{
    const types = ["TSCH", "RPL", "Other"];
    const dst = ["BC", "UC"];
    return types[packet_type] + "_" + dst[packet_dst];
}

export class CollisionAnalyzer {
    constructor(node) {
        this.node = node;
        this.clear();
    }

    clear() {
        this.packets = [];
        for (let packet_type = 0; packet_type < 3; ++packet_type) {
            this.packets[packet_type] = [];
            for (let packet_dst = 0; packet_dst < 2; ++packet_dst) {
                this.packets[packet_type][packet_dst] = [];
                for (let packet_status = 0; packet_status < 4; ++packet_status) {
                    this.packets[packet_type][packet_dst][packet_status] = 0;
                }
            }
        }
    }

    add_packet(packet, packet_status) {
        const packet_dst = packet.nexthop_id <= 0 ? PACKET_DESTINATION_BC : PACKET_DESTINATION_UC;
        const packet_type = packet.packet_protocol === constants.PROTO_TSCH ?
                             PACKET_TYPE_TSCH :
                             (packet.packet_protocol === constants.PROTO_ICMP6 ?
                              PACKET_TYPE_RPL : PACKET_TYPE_OTHER);
        this.packets[packet_type][packet_dst][packet_status] += 1;
    }

    get() {
        let r = {};
        for (let packet_type = 0; packet_type < 3; ++packet_type) {
            for (let packet_dst = 0; packet_dst < 2; ++packet_dst) {
                const stats = this.packets[packet_type][packet_dst];
                const name = get_name(packet_type, packet_dst);
                r[name] = [stats[PACKET_RX_OK],
                           stats[PACKET_RX_COLLISION],
                           stats[PACKET_RX_LINK_FAILED],
                           stats[PACKET_RX_WRONG_ADDRESS]];
            }
        }
        return r;
    }

    aggregate(existing_stats) {
        if (existing_stats == null) {
            existing_stats = {};
            for (let packet_type = 0; packet_type < 3; ++packet_type) {
                for (let packet_dst = 0; packet_dst < 2; ++packet_dst) {
                    const name = get_name(packet_type, packet_dst);
                    existing_stats[name] = [0, 0, 0, 0];
                }
            }
        }
        let my_stats = this.get();
        for (let packet_type = 0; packet_type < 3; ++packet_type) {
            for (let packet_dst = 0; packet_dst < 2; ++packet_dst) {
                for (let packet_status = 0; packet_status < 4; ++packet_status) {
                    const name = get_name(packet_type, packet_dst);
                    existing_stats[name][packet_status] += my_stats[name][packet_status];
                    const total = existing_stats[name][0] + existing_stats[name][1]
                          + existing_stats[name][2] + existing_stats[name][3];
                    const rate_collided = total <= 0 ? 0 : (existing_stats[name][1] / total);
                    existing_stats[name + " % collisions"] = (100.0 * rate_collided).toFixed(2);
                }
            }
        }
        return existing_stats;
    }
}
