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
 *         Leaf-and-forwarder scheduler.
 * \author
 *         Atis Elsts <atis.elsts@edi.lv>
 */

import config from './config.mjs';
import constants from './constants.mjs';
import * as log from './log.mjs';
import * as time from './time.mjs';

/* ------------------------------------------------- */

function set_timings()
{
    // Slotframe size
    const sf_size = config.TSCH_SCHEDULE_CONF_DEFAULT_LENGTH ? config.TSCH_SCHEDULE_CONF_DEFAULT_LENGTH : 1;

    let timings_usec = new Array(sf_size);
    /* all slots have the same duration */
    for (let i = 0; i < sf_size; ++i) {
        timings_usec[i] = config.MAC_SLOT_DURATION_US;
    }
    // MAC_SLOT_DURATION is in microseconds, convert them to seconds using the map method
    time.timeline.slot_timings = timings_usec.map(x => x / 1000000); /* convert to seconds */
}

/* ------------------------------------------------- */
// Executed when a packet is ready for transmission
export function on_packet_ready(node, packet)
{
    let remote_offset = 0;
    // No packet exists for next hop
    if (packet.nexthop_id <= 0) {
        /* broadcast transmission attempted? */
        log.log(log.ERROR, node, "TSCH", `the LeafAndForwarder scheduler is currently not suitable for broadcast [LEAF AND FORWARDER]`);
        if (!node.config.ROUTING_IS_LEAF && node.idd !== constants.ROOT_NODE_ID) {
            /* make the best guess and try to address the packet to the root */
            remote_offset = 1 + constants.ROOT_NODE_ID % (config.TSCH_SCHEDULE_CONF_DEFAULT_LENGTH - 1);
        }
    } else {
        // Set the destination address as the next hop ID
        const dest_addr = packet.nexthop_addr;
        // Offset of the channel packet is to be sent on
        remote_offset = 1 + dest_addr.u8[dest_addr.u8.length - 1] % (config.TSCH_SCHEDULE_CONF_DEFAULT_LENGTH - 1);
    }

    log.log(log.INFO, node, "TSCH", `schedule packet,  [src: ${packet.source.id}, dest: ${packet.nexthop_id}, seqnum: ${packet.seqnum}], channel offset=${remote_offset} [LEAF AND FORWARDER]`);

    let timeslot;
    // if (packet.nexthop_id === constants.ROOT_NODE_ID) {
    //     /* To a forwarder or gateway */
    //     timeslot = 0xffffffff;
    // } else 
    // if (node.config.ROUTING_IS_LEAF) {
        const local_offset = 1 + node.addr.u8[node.addr.u8.length - 1] % (config.TSCH_SCHEDULE_CONF_DEFAULT_LENGTH - 1);

        timeslot = local_offset;
    // }
    // else {
    //     /* To a leaf node */
    //     timeslot = remote_offset;
    // }

    packet.packetbuf.PACKETBUF_ATTR_TSCH_SLOTFRAME = 0;
    packet.packetbuf.PACKETBUF_ATTR_TSCH_TIMESLOT = timeslot;
    packet.packetbuf.PACKETBUF_ATTR_TSCH_CHANNEL_OFFSET = remote_offset;

    return true;
}

/*---------------------------------------------------------------------------*/
export function on_new_time_source(node, old_neighbor, new_neighbor)
{
    /* nothing */
}

export function on_child_added(node, addr)
{
    /* nothing */
}

export function on_child_removed(node, addr)
{
    /* nothing */
}

export function on_tx(node, packet, status_ok)
{
    /* nothing */
}

export function add_root(node, root_id)
{
    /* nothing */
}

export function on_node_becomes_root(node)
{
    /* nothing */
}

/*---------------------------------------------------------------------------*/

/* Initialize a specific node: function required by the scheduling module API */
export function node_init(node)
{
    log.log(log.INFO, node, "TSCH", `*** initializing leaf-and-forwarder scheduler, slotframe_size=${node.config.TSCH_SCHEDULE_CONF_DEFAULT_LENGTH} [LEAF AND FORWARDER]`);

    /* Add a single slotframe */
    const sf_common = node.add_slotframe(0, "leaf-and-forwarder", node.config.TSCH_SCHEDULE_CONF_DEFAULT_LENGTH);

    /* Add a single cell for EB */
    node.add_cell(sf_common,
                  constants.CELL_OPTION_RX | constants.CELL_OPTION_TX | constants.CELL_OPTION_SHARED,
                  constants.CELL_TYPE_ADVERTISING_ONLY,
                  constants.BROADCAST_ID,
                  0, 0);

    const local_offset = 1 + node.addr.u8[node.addr.u8.length - 1] % (config.TSCH_SCHEDULE_CONF_DEFAULT_LENGTH - 1);

    log.log(log.INFO, node, "TSCH", `add cells at channel offset=${local_offset} [LEAF AND FORWARDER]`);

    if (node.config.ROUTING_IS_LEAF) {
        node.add_cell(sf_common,
                      constants.CELL_OPTION_RX | constants.CELL_OPTION_TX | constants.CELL_OPTION_SHARED,
                      constants.CELL_TYPE_NORMAL,
                      constants.BROADCAST_ID,
                      local_offset, local_offset);
    } else {
        for (let i = 1; i < config.TSCH_SCHEDULE_CONF_DEFAULT_LENGTH; ++i) {
            node.add_cell(sf_common,
                          constants.CELL_OPTION_RX | constants.CELL_OPTION_TX | constants.CELL_OPTION_SHARED,
                          constants.CELL_TYPE_NORMAL,
                          constants.BROADCAST_ID,
                          i, local_offset);
        }
    }
}

/* ------------------------------------------------- */

/* Initialize the module: function required by the scheduling module API */
export function initialize()
{
    log.log(log.INFO, null, "TSCH", `initializing leaf-and-forwarder scheduler [LEAF AND FORWARDER]`);

    const default_config = {
        /* The length of the leaf-and-forwarder slotframe */
        TSCH_SCHEDULE_CONF_DEFAULT_LENGTH: 7
    };

    for (const key in default_config) {
        /* set the ones that have not been set from the config file */
        if (!config.hasOwnProperty(key)) {
            config[key] = default_config[key];
        }
    }

    set_timings();
}
