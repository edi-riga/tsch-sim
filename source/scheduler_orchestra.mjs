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
 *         Orchestra scheduler rules as shipped with the Contiki-NG operating system
 *         Based on the code by Simon Duquennoy <simonduq@sics.se>.
 * \author
 *         Atis Elsts <atis.elsts@edi.lv>
 */

import config from './config.mjs';
import constants from './constants.mjs';
import * as log from './log.mjs';
import * as time from './time.mjs';
import { addr_to_id, id_to_addr, addr_equal, assert } from './utils.mjs';

/*---------------------------------------------------------------------------*/

/* Module logging */
function mlog(severity, node, msg) {
    log.log(severity, node, "TSCH", "Orchestra: " + msg);
}

/*---------------------------------------------------------------------------*/

/*
 *         Orchestra: a slotframe with a single shared cell, common to all nodes
 *         in the network, used for unicast and broadcast.
 */
function default_common_select_packet(node, packet)
{
    /* We are the default slotframe, select anything */
    return {slotframe: node.sf_common, timeslot: 0};
}

function default_common_init(node, slotframe_handle)
{
    node.sf_common = node.add_slotframe(slotframe_handle,
                                        orchestra_rule_default_common.name,
                                        config.ORCHESTRA_COMMON_SHARED_PERIOD);

    node.add_cell(node.sf_common,
                  constants.CELL_OPTION_RX | constants.CELL_OPTION_TX | constants.CELL_OPTION_SHARED,
                  config.ORCHESTRA_COMMON_SHARED_TYPE,
                  constants.BROADCAST_ID,
                  0, config.ORCHESTRA_DEFAULT_COMMON_CHANNEL_OFFSET);
}

const orchestra_rule_default_common = {
    name: "default common",
    init: default_common_init,
    select_packet: default_common_select_packet,
    get_sf_size: function() { return config.ORCHESTRA_COMMON_SHARED_PERIOD; },
};

/* ------------------------------------------------- */

/*
 *         Orchestra: a slotframe dedicated to transmission of EBs.
 *         Nodes transmit at a timeslot defined as hash(MAC) % ORCHESTRA_EBSF_PERIOD
 *         Nodes listen at a timeslot defined as hash(time_source.MAC) % ORCHESTRA_EBSF_PERIOD
 */
function eb_get_node_timeslot(addr)
{
    if (config.ORCHESTRA_EBSF_PERIOD > 0) {
        return config.ORCHESTRA_LINKADDR_HASH(addr) % config.ORCHESTRA_EBSF_PERIOD;
    } else {
        return 0xffffffff;
    }
}

function eb_select_packet(node, packet)
{
    /* Select EBs only */
    if (packet.packetbuf.PACKETBUF_ATTR_FRAME_TYPE === constants.FRAME802154_BEACONFRAME) {
        return { slotframe: node.sf_eb, timeslot: eb_get_node_timeslot(node.addr) };
    }
    return null;
}

function eb_init(node, slotframe_handle)
{
    node.sf_eb = node.add_slotframe(slotframe_handle,
                                    orchestra_rule_eb_per_time_source.name,
                                    config.ORCHESTRA_EBSF_PERIOD);

    /* EB cell: every neighbor uses its own to avoid contention */
    node.add_cell(node.sf_eb,
                  constants.CELL_OPTION_TX,
                  constants.CELL_TYPE_ADVERTISING_ONLY,
                  constants.BROADCAST_ID,
                  eb_get_node_timeslot(node.addr),
                  config.ORCHESTRA_EB_CHANNEL_OFFSET);
}

function eb_new_time_source(node, old_neighbor, new_neighbor)
{
    const old_ts = old_neighbor ? eb_get_node_timeslot(id_to_addr(old_neighbor.id)) : 0xffffffff;
    const new_ts = new_neighbor ? eb_get_node_timeslot(id_to_addr(new_neighbor.id)) : 0xffffffff;

    if (new_ts === old_ts) {
        return;
    }

    if (old_ts !== 0xffffffff) {
        /* Stop listening to the old time source's EBs */
        if (old_ts === eb_get_node_timeslot(node.addr)) {
            /* This was the same timeslot as slot. Reset original cell options */
            node.add_cell(node.sf_eb,
                          constants.CELL_OPTION_TX,
                          constants.CELL_TYPE_ADVERTISING_ONLY,
                          constants.BROADCAST_ID,
                          old_ts, config.ORCHESTRA_EB_CHANNEL_OFFSET);
        } else {
            /* Remove slot */
            node.remove_cell_by_timeslot(node.sf_eb, old_ts, config.ORCHESTRA_EB_CHANNEL_OFFSET);
        }
    }
    if (new_ts !== 0xffffffff) {
        let cell_options = constants.CELL_OPTION_RX;
        if (new_ts === eb_get_node_timeslot(node.addr)) {
            /* This is also our timeslot, add necessary flags */
            cell_options |= constants.CELL_OPTION_TX;
        }
        /* Listen to the time source's EBs */
        node.add_cell(node.sf_eb,
                      cell_options,
                      constants.CELL_TYPE_ADVERTISING_ONLY,
                      constants.BROADCAST_ID,
                      new_ts, config.ORCHESTRA_EB_CHANNEL_OFFSET);
    }
}

const orchestra_rule_eb_per_time_source = {
    name: "EB per time source",
    init: eb_init,
    select_packet: eb_select_packet,
    new_time_source: eb_new_time_source,
    get_sf_size: function() { return config.ORCHESTRA_EBSF_PERIOD; },
};

/* ------------------------------------------------- */

/*
 *         Orchestra: a slotframe dedicated to unicast data transmission. Designed primarily
 *         for RPL non-storing mode but would work with any mode-of-operation. Does not require
 *         any knowledge of the children. Works only as received-base, and as follows:
 *           Nodes listen at a timeslot defined as hash(MAC) % ORCHESTRA_SB_UNICAST_PERIOD
 *           Nodes transmit at: for any neighbor, hash(nbr.MAC) % ORCHESTRA_SB_UNICAST_PERIOD
*/
function unicast_get_node_timeslot(addr)
{
    if (addr && config.ORCHESTRA_UNICAST_PERIOD > 0) {
        return config.ORCHESTRA_LINKADDR_HASH(addr) % config.ORCHESTRA_UNICAST_PERIOD;
    } else {
        return 0xffffffff;
    }
}

function unicast_get_node_pair_timeslot(from, to)
{
    if (from && to && config.ORCHESTRA_UNICAST_PERIOD > 0) {
        return config.ORCHESTRA_LINKADDR_HASH2(from, to) % config.ORCHESTRA_UNICAST_PERIOD;
    } else {
        return 0xffffffff;
    }
}

function unicast_get_node_channel_offset(addr)
{
  if (addr && config.ORCHESTRA_UNICAST_MAX_CHANNEL_OFFSET >= config.ORCHESTRA_UNICAST_MIN_CHANNEL_OFFSET) {
    return config.ORCHESTRA_LINKADDR_HASH(addr) % (config.ORCHESTRA_UNICAST_MAX_CHANNEL_OFFSET - config.ORCHESTRA_UNICAST_MIN_CHANNEL_OFFSET + 1)
        + config.ORCHESTRA_UNICAST_MIN_CHANNEL_OFFSET;
  } else {
    return 0xffffffff;
  }
}

function ns_select_packet(node, packet)
{
    const dest_addr = packet.nexthop_addr;
    const dest_id = packet.nexthop_id;

    /* mlog(log.DEBUG, node, `ns_select_packet, type=${packet.packetbuf.PACKETBUF_ATTR_FRAME_TYPE}, dest_id=${dest_id}`) */

    if (packet.packetbuf.PACKETBUF_ATTR_FRAME_TYPE === constants.FRAME802154_DATAFRAME
        && dest_addr != null
        && !orchestra_is_root_schedule_active(node, dest_id)) {
        return { slotframe: node.sf_unicast,
                 timeslot: unicast_get_node_timeslot(dest_addr),
                 channel_offset: unicast_get_node_channel_offset(dest_addr) 
               };
    }
    return null;
}

function ns_init(node, slotframe_handle)
{
    /* Slotframe for unicast transmissions */
    node.sf_unicast = node.add_slotframe(slotframe_handle,
                                         orchestra_rule_unicast_per_neighbor_rpl_ns.name,
                                         config.ORCHESTRA_UNICAST_PERIOD);

    const rx_timeslot = unicast_get_node_timeslot(node.addr);
    const channel_offset = unicast_get_node_channel_offset(node.addr);

    /* Add a Tx cell at each available timeslot. Make the cell Rx at our own timeslot. */
    for (let i = 0; i < config.ORCHESTRA_UNICAST_PERIOD; i++) {
        node.add_cell(node.sf_unicast,
                      constants.CELL_OPTION_SHARED | constants.CELL_OPTION_TX | ( i === rx_timeslot ? constants.CELL_OPTION_RX : 0 ),
                      constants.CELL_TYPE_NORMAL,
                      constants.BROADCAST_ID,
                      i, channel_offset);
    }
}

const orchestra_rule_unicast_per_neighbor_rpl_ns = {
    name: "unicast per neighbor non-storing",
    init: ns_init,
    select_packet: ns_select_packet,
    get_sf_size: function() { return config.ORCHESTRA_UNICAST_PERIOD; },
};

/* ------------------------------------------------- */

/*
 *         Orchestra: a slotframe dedicated to unicast data transmission. Designed for
 *         RPL storing mode only, as this is based on the knowledge of the children (and parent).
 *         If receiver-based:
 *           Nodes listen at a timeslot defined as hash(MAC) % ORCHESTRA_SB_UNICAST_PERIOD
 *           Nodes transmit at: for each nbr in RPL children and RPL preferred parent,
 *                                             hash(nbr.MAC) % ORCHESTRA_SB_UNICAST_PERIOD
 *         If sender-based: the opposite
 */

function storing_neighbor_has_uc_cell(node, linkaddr)
{
    if (linkaddr != null) {
        /* does the address belong to the parent? */
        if ((node.orchestra_parent_knows_us || !config.ORCHESTRA_UNICAST_SENDER_BASED)
            && addr_equal(node.orchestra_parent_linkaddr, linkaddr)) {
            return true;
        }

        /* does the address belong to a child? */
        const route = node.routes.get_route(addr_to_id(linkaddr));
        if (route && route.is_direct()) {
            return true;
        }
    }
    return false;
}

function storing_select_packet(node, packet)
{
    const dest_addr = packet.nexthop_addr;
    const dest_id = packet.nexthop_id;

    if (packet.packetbuf.PACKETBUF_ATTR_FRAME_TYPE === constants.FRAME802154_DATAFRAME
        && dest_addr != null
        && !orchestra_is_root_schedule_active(node, dest_id)) {

        if (storing_neighbor_has_uc_cell(node, dest_addr)) {

            return { slotframe: node.sf_unicast,
                     timeslot: unicast_get_node_timeslot(config.ORCHESTRA_UNICAST_SENDER_BASED ? node.addr : dest_addr),
                     channel_offset: unicast_get_node_channel_offset(dest_addr)
                   };
        } else {
            mlog(log.DEBUG, node, `storing_select_packet: unicast, but neighbor=${packet.nexthop_id} does not have a cell`);
        }
    } else {
        mlog(log.DEBUG, node, `storing_select_packet: type=${packet.packetbuf.PACKETBUF_ATTR_FRAME_TYPE} dest_id=${dest_id} to=${packet.nexthop_id}`);
    }

    return null;
}

function add_uc_cell(node, addr)
{
    if (addr == null) {
        return;
    }

    const timeslot = unicast_get_node_timeslot(addr);
    let cell_options = config.ORCHESTRA_UNICAST_SENDER_BASED ?
          constants.CELL_OPTION_RX :
          constants.CELL_OPTION_TX | node.config.ORCHESTRA_UNICAST_SLOT_SHARED_FLAG;

    mlog(log.INFO, node, `storing mode: add uc cell to ${addr_to_id(addr)}, timeslot=${timeslot}`);

    if (timeslot === unicast_get_node_timeslot(node.addr)) {
        /* This is also our timeslot, add necessary flags */
        cell_options |= config.ORCHESTRA_UNICAST_SENDER_BASED ?
            constants.CELL_OPTION_TX | node.config.ORCHESTRA_UNICAST_SLOT_SHARED_FLAG :
            constants.CELL_OPTION_RX;
    }

    /* Add/update cell.
     * Always configure the cell with the local node's channel offset.
     * If this is an Rx cell, that is what the node needs to use.
     * If this is a Tx cell, packet's channel offset will override the cell's channel offset.
     */
    node.add_cell(node.sf_unicast,
                  cell_options,
                  constants.CELL_TYPE_NORMAL,
                  constants.BROADCAST_ID,
                  timeslot,
                  unicast_get_node_channel_offset(node.addr));
}

function remove_uc_cell(node, addr)
{
    if (addr == null) {
        return;
    }

    const timeslot = unicast_get_node_timeslot(addr);

    mlog(log.INFO, node, `storing mode: remove uc cell to ${addr_to_id(addr)}, timeslot=${timeslot}`);

    const old_cell = node.get_cell(node.sf_unicast,
                                   timeslot,
                                   unicast_get_node_channel_offset(node.addr));
    if (!old_cell) {
        return;
    }


    /* Does our current parent need this timeslot? */
    if (timeslot === unicast_get_node_timeslot(node.orchestra_parent_linkaddr)) {
        /* Yes, this timeslot is being used, return */
        return;
    }

    /* Does any other child need this timeslot?
     * (lookup all route next hops) */
    for (const [_, route] of node.routes.routes) {
        if (route.is_direct()) {
            if (timeslot === unicast_get_node_timeslot(id_to_addr(route.nexthop_id))) {
                /* Yes, this timeslot is being used, return */
                return;
            }
        }
    }

    /* Do we need this timeslot? */
    if (timeslot === unicast_get_node_timeslot(node.addr)) {
        /* This is our cell, keep it but update the cell options */
        const cell_options = config.ORCHESTRA_UNICAST_SENDER_BASED ?
              constants.CELL_OPTION_TX | node.config.ORCHESTRA_UNICAST_SLOT_SHARED_FLAG :
              constants.CELL_OPTION_RX;
        node.add_cell(node.sf_unicast,
                      cell_options,
                      constants.CELL_TYPE_NORMAL,
                      constants.BROADCAST_ID,
                      timeslot,
                      unicast_get_node_channel_offset(node.addr));
    } else {
        /* Remove cell */
        node.remove_cell(node.sf_unicast, old_cell);
    }

}

function storing_new_time_source(node, old_neighbor, new_neighbor)
{
    if (old_neighbor !== new_neighbor) {
        const old_addr = old_neighbor ? id_to_addr(old_neighbor.id) : null;
        const new_addr = new_neighbor ? id_to_addr(new_neighbor.id) : null;
        node.orchestra_parent_linkaddr = new_addr;
        remove_uc_cell(node, old_addr);
        add_uc_cell(node, new_addr);
    }
}

function storing_child_added(node, addr)
{
    add_uc_cell(node, addr);
}

function storing_child_removed(node, addr)
{
    remove_uc_cell(node, addr);
}

function storing_init(node, slotframe_handle)
{
    const rule_type = node.config.ORCHESTRA_UNICAST_SENDER_BASED ?
          "sender based" :
          "receiver based";
    mlog(log.INFO, node, `storing rule, ${rule_type}`);

    /* Slotframe for unicast transmissions */
    node.sf_unicast = node.add_slotframe(slotframe_handle,
                                         orchestra_rule_unicast_per_neighbor_rpl_storing.name,
                                         config.ORCHESTRA_UNICAST_PERIOD);

    const timeslot = unicast_get_node_timeslot(node.addr);
    const local_channel_offset = unicast_get_node_channel_offset(node.addr);

    node.add_cell(node.sf_unicast,
                  config.ORCHESTRA_UNICAST_SENDER_BASED ?
                  constants.CELL_OPTION_TX | node.config.ORCHESTRA_UNICAST_SLOT_SHARED_FLAG :
                  constants.CELL_OPTION_RX,
                  constants.CELL_TYPE_NORMAL,
                  constants.BROADCAST_ID,
                  timeslot, local_channel_offset);
}

const orchestra_rule_unicast_per_neighbor_rpl_storing = {
    name: "unicast per neighbor storing",
    init: storing_init,
    select_packet: storing_select_packet,
    new_time_source: storing_new_time_source,
    child_added: storing_child_added,
    child_removed: storing_child_removed,
    get_sf_size: function() { return config.ORCHESTRA_UNICAST_PERIOD; },
};

/* ------------------------------------------------- */

/*
 *         Orchestra: a slotframe dedicated to unicast data transmission to the root.
 *         See the paper "TSCH for Long Range Low Data Rate Applications", IEEE Access
 */

function to_root_get_node_timeslot(addr)
{
    if (addr && config.ORCHESTRA_ROOT_PERIOD > 0) {
        return config.ORCHESTRA_LINKADDR_HASH(addr) % config.ORCHESTRA_ROOT_PERIOD;
    } else {
        return 0xffffffff;
    }
}

function orchestra_is_root_schedule_active(node, root_id)
{
    return node.sf_to_root != null && node.roots[root_id];
}

function special_for_root_select_packet(node, packet)
{
    const dest_addr = packet.nexthop_addr;
    const dest_id = packet.nexthop_id;

    if (!node.is_coordinator
        && packet.packetbuf.PACKETBUF_ATTR_FRAME_TYPE === constants.FRAME802154_DATAFRAME
        && orchestra_is_root_schedule_active(node, dest_id)) {

        mlog(log.DEBUG, node, `special_for_root_select_packet: use the root rule to neighbor=${packet.nexthop_id}`);

        return { slotframe: node.sf_to_root,
                 timeslot: to_root_get_node_timeslot(node.addr),
                 channel_offset: unicast_get_node_channel_offset(dest_addr)
               };
    }

    return null;
}

function special_for_root_root_node_updated(node, root_id, is_added)
{
    assert(is_added, "Root node removal not supported yet");

    mlog(log.INFO, node, `special_for_root_root_node_updated: ${root_id} becomes root`);

    const root_addr = id_to_addr(root_id);

    const timeslot = to_root_get_node_timeslot(node.addr);
    const channel_offset = unicast_get_node_channel_offset(root_addr);

    node.add_cell(node.sf_to_root,
                  constants.CELL_OPTION_TX | constants.CELL_OPTION_SHARED,
                  constants.CELL_TYPE_NORMAL,
                  constants.BROADCAST_ID,
                  timeslot, channel_offset);
}

function special_for_root_init_on_root(node)
{
    if (node.sf_to_root == null) {
        /* wait for initialization of the rule */
        return;
    }

    const slotframe_rx_handle = node.sf_to_root.handle | 0x8000;

    /* Add a 1-slot slotframe for unicast reception */
    const sf_rx = node.add_slotframe(slotframe_rx_handle, orchestra_rule_special_for_root.name, 1);
    /* Rx link */
    const timeslot = 0;
    const local_channel_offset = unicast_get_node_channel_offset(node.addr);

    mlog(log.INFO, node, `special for root rule: initialize on the root`);

    node.add_cell(sf_rx,
                  constants.CELL_OPTION_RX,
                  constants.CELL_TYPE_NORMAL,
                  constants.BROADCAST_ID,
                  timeslot, local_channel_offset);
}

function special_for_root_init(node, slotframe_handle)
{
    /* Slotframe for unicast transmissions */
    node.sf_to_root = node.add_slotframe(slotframe_handle,
                                         orchestra_rule_special_for_root.name,
                                         config.ORCHESTRA_ROOT_PERIOD);

    if (node.is_coordinator) {
        special_for_root_init_on_root(node);
    }
}

const orchestra_rule_special_for_root = {
    name: "special for root",
    init: special_for_root_init,
    select_packet: special_for_root_select_packet,
    root_updated: special_for_root_root_node_updated,
    get_sf_size: function() { return config.ORCHESTRA_ROOT_PERIOD; },
};

/* ------------------------------------------------- */

function link_based_neighbor_has_uc_cell(node, linkaddr)
{
    if (linkaddr != null) {
        /* does the address belong to the parent? */
        if ((node.orchestra_parent_knows_us)
            && addr_equal(node.orchestra_parent_linkaddr, linkaddr)) {
            return true;
        }

        /* does the address belong to a child? */
        const route = node.routes.get_route(addr_to_id(linkaddr));
        if (route && route.is_direct()) {
            return true;
        }
    }
    return false;
}

function link_based_select_packet(node, packet)
{
    const dest_addr = packet.nexthop_addr;
    const dest_id = packet.nexthop_id;

    if (packet.packetbuf.PACKETBUF_ATTR_FRAME_TYPE === constants.FRAME802154_DATAFRAME
        && dest_addr != null
        && !orchestra_is_root_schedule_active(node, dest_id)) {

        if (link_based_neighbor_has_uc_cell(node, dest_addr)) {

            return { slotframe: node.sf_unicast,
                     timeslot: unicast_get_node_pair_timeslot(node.addr, dest_addr),
                     channel_offset: unicast_get_node_channel_offset(dest_addr)
                   };
        } else {
            mlog(log.DEBUG, node, `link_based_select_packet: unicast, but neighbor=${packet.nexthop_id} does not have a cell`);
        }
    } else {
        mlog(log.DEBUG, node, `link_based_select_packet: type=${packet.packetbuf.PACKETBUF_ATTR_FRAME_TYPE} dest_id=${dest_id} to=${packet.nexthop_id}`);

    }

    return null;
}

function link_based_add_uc_cells(node, addr)
{
    if (addr) {
        const timeslot_rx = unicast_get_node_pair_timeslot(addr, node.addr);
        const timeslot_tx = unicast_get_node_pair_timeslot(node.addr, addr);
        const channel_offset = unicast_get_node_channel_offset(node.addr);

        /* Add Tx cell */
        node.add_cell(node.sf_unicast,
                      constants.CELL_OPTION_TX | constants.CELL_OPTION_SHARED,
                      constants.CELL_TYPE_NORMAL,
                      constants.BROADCAST_ID,
                      timeslot_tx,
                      channel_offset,
                      true);
        /* Add Rx cell */
        node.add_cell(node.sf_unicast,
                      constants.CELL_OPTION_RX,
                      constants.CELL_TYPE_NORMAL,
                      constants.BROADCAST_ID,
                      timeslot_rx,
                      channel_offset,
                      true);
    }
}

function link_based_remove_uc_cells(node, addr)
{
    if (addr) {
        const timeslot_rx = unicast_get_node_pair_timeslot(addr, node.addr);
        const timeslot_tx = unicast_get_node_pair_timeslot(node.addr, addr);
        const channel_offset = unicast_get_node_channel_offset(node.addr);

        node.sf_unicast.remove_cell_by_timeslot_co_and_options(timeslot_tx,
                                                               channel_offset,
                                                               constants.CELL_OPTION_TX | constants.CELL_OPTION_SHARED);
        node.sf_unicast.remove_cell_by_timeslot_co_and_options(timeslot_rx,
                                                               channel_offset,
                                                               constants.CELL_OPTION_RX);
    }
}

function link_based_new_time_source(node, old_neighbor, new_neighbor)
{
    if (old_neighbor !== new_neighbor) {
        const old_addr = old_neighbor ? id_to_addr(old_neighbor.id) : null;
        const new_addr = new_neighbor ? id_to_addr(new_neighbor.id) : null;
        node.orchestra_parent_linkaddr = new_addr;
        link_based_remove_uc_cells(node, old_addr);
        link_based_add_uc_cells(node, new_addr);
    }
}

function link_based_child_added(node, addr)
{
    link_based_add_uc_cells(node, addr);
}

function link_based_child_removed(node, addr)
{
    link_based_remove_uc_cells(node, addr);
}

function link_based_init(node, slotframe_handle)
{
    /* Slotframe for unicast transmissions */
    node.sf_unicast = node.add_slotframe(slotframe_handle,
                                         orchestra_rule_unicast_per_neighbor_link_based.name,
                                         config.ORCHESTRA_UNICAST_PERIOD);
}

const orchestra_rule_unicast_per_neighbor_link_based = {
    name: "unicast per neighbor link based",
    init: link_based_init,
    select_packet: link_based_select_packet,
    new_time_source: link_based_new_time_source,
    child_added: link_based_child_added,
    child_removed: link_based_child_removed,
    get_sf_size: function() { return config.ORCHESTRA_UNICAST_PERIOD; },
};

/* ------------------------------------------------- */

export function on_new_time_source(node, old_neighbor, new_neighbor)
{
    /* Orchestra assumes that the time source is also the RPL parent.
     * This is the case if the following is set:
     * #define RPL_CALLBACK_PARENT_SWITCH tsch_rpl_callback_parent_switch
     * */

    mlog(log.INFO, node, `new time source ${new_neighbor ? new_neighbor.id : null}`)

    if (new_neighbor !== old_neighbor) {
        node.orchestra_parent_knows_us = false;
    }
    if (node.orchestra_rules) {
        for (let i = 0; i < node.orchestra_rules.length; i++) {
            if (node.orchestra_rules[i].hasOwnProperty("new_time_source")) {
                node.orchestra_rules[i].new_time_source(node, old_neighbor, new_neighbor);
            }
        }
    }
}

/* ------------------------------------------------- */

export function on_child_added(node, addr)
{
    mlog(log.INFO, node, `child added ${addr_to_id(addr)}`)

    for (let i = 0; i < node.orchestra_rules.length; i++) {
        if (node.orchestra_rules[i].hasOwnProperty("child_added")) {
            node.orchestra_rules[i].child_added(node, addr);
        }
    }
}

/* ------------------------------------------------- */

export function on_child_removed(node, addr)
{
    mlog(log.INFO, node, `child removed ${addr_to_id(addr)}`);

    for (let i = 0; i < node.orchestra_rules.length; i++) {
        if (node.orchestra_rules[i].hasOwnProperty("child_removed")) {
            node.orchestra_rules[i].child_removed(node, addr);
        }
    }
}

/* ------------------------------------------------- */

export function on_tx(node, packet, status_ok)
{
    const RPL_CODE_DAO                = 0x02; /* Destination Advertisement Option */

    /* check if our parent just ACKed a DAO */
    if (packet.packet_protocol === constants.PROTO_ICMP6
        && packet.msg_type === RPL_CODE_DAO
        && status_ok) {

        mlog(log.INFO, node, `parent acked a DAO`);

        /* yes! */
        if (node.orchestra_parent_linkaddr != null
            && addr_equal(packet.nexthop_addr, node.orchestra_parent_linkaddr)) {
            node.orchestra_parent_knows_us = true;
        }
    }
}

/* ------------------------------------------------- */

export function on_packet_ready(node, packet)
{
    /* By default, use any slotframe, any timeslot */
    packet.packetbuf.PACKETBUF_ATTR_TSCH_SLOTFRAME = 0xffffffff;
    packet.packetbuf.PACKETBUF_ATTR_TSCH_TIMESLOT = 0xffffffff;
    /* The default channel offset 0xffffffff means that the channel offset in the scheduled
     * tsch_cell structure is used instead. Any other value specified in the packetbuf
     * overrides per-cell value, allowing to implement multi-channel Orchestra. */
    packet.packetbuf.PACKETBUF_ATTR_TSCH_CHANNEL_OFFSET = 0xffffffff;

    /* Loop over all rules until finding one able to handle the packet */
    for (let i = 0; i < node.orchestra_rules.length; i++) {
        const rule = node.orchestra_rules[i];
        if (rule.select_packet != null) {
            const obj = rule.select_packet(node, packet);
            if (obj != null) {
                /* found a matching rule */
                packet.packetbuf.PACKETBUF_ATTR_TSCH_SLOTFRAME = obj.slotframe.handle;
                packet.packetbuf.PACKETBUF_ATTR_TSCH_TIMESLOT = obj.timeslot;
                let channel_offset = obj.hasOwnProperty("channel_offset") ? obj.channel_offset : 0xffffffff;
                packet.packetbuf.PACKETBUF_ATTR_TSCH_CHANNEL_OFFSET = channel_offset;
                mlog(log.DEBUG, node, `selected slotframe="${obj.slotframe.rule_name}" timeslot=${obj.timeslot === 0xffffffff ? -1 : obj.timeslot} choffset=${channel_offset === 0xffffffff ? -1 : channel_offset}`);
                return true;
            }
        }
    }

    mlog(log.DEBUG, node, `no matching slotframes!`);
    return false;
}

/* ------------------------------------------------- */

export function add_root(node, root_id)
{
    if (!node.roots[root_id]) {
        node.roots[root_id] = true;
        /* Initialize all Orchestra rules */
        for (let i = 0; i < node.orchestra_rules.length; i++) {
            const rule = node.orchestra_rules[i];
            if (rule.root_updated != null) {
                rule.root_updated(node, root_id, true);
            }
        }
    }
}

/* ------------------------------------------------- */

export function on_node_becomes_root(node)
{
    special_for_root_init_on_root(node);
}

/* ------------------------------------------------- */

function orchestra_set_timings()
{
    const sf_size = config.ORCHESTRA_UNICAST_PERIOD ? config.ORCHESTRA_UNICAST_PERIOD : 1;

    let timings_usec = new Array(sf_size);
    /* all slots have the same duration */
    for (let i = 0; i < sf_size; ++i) {
        timings_usec[i] = config.MAC_SLOT_DURATION_US;
    }
    time.timeline.slot_timings = timings_usec.map(x => x / 1000000); /* convert to seconds */
}

/* ------------------------------------------------- */

const all_rules = {
    orchestra_rule_eb_per_time_source,
    orchestra_rule_unicast_per_neighbor_rpl_storing,
    orchestra_rule_unicast_per_neighbor_rpl_ns,
    orchestra_rule_unicast_per_neighbor_link_based,
    orchestra_rule_special_for_root,
    orchestra_rule_default_common
}

/* Initialize a specific node: function required by the scheduling module API */
export function node_init(node)
{
    mlog(log.INFO, node, `*** initializing`);

    /* The current RPL preferred parent's link-layer address */
    node.orchestra_parent_linkaddr = null;
    /* Set to one only after getting an ACK for a DAO sent to our preferred parent */
    node.orchestra_parent_knows_us = false;
    /* Dictionary of all known direct neighbor root node ID */
    node.roots = {};

    node.orchestra_rules = [];
    for (const rule of node.config.ORCHESTRA_RULES) {
        if (rule in all_rules) {
            node.orchestra_rules.push(all_rules[rule]);
        } else {
            mlog(log.WARNING, node, `rule ${rule} not found`);
        }
    }
    /* Initialize all Orchestra rules */
    for (let i = 0; i < node.orchestra_rules.length; i++) {
        const rule = node.orchestra_rules[i];
        mlog(log.INFO, node, `initializing rule ${rule.name} (handle=${i} slotframe_size=${rule.get_sf_size()})`);
        if (rule.init != null) {
            rule.init(node, i);
        }
    }
    mlog(log.INFO, node, "initialization done");
}

/* ------------------------------------------------- */

/* Initialize the module: function required by the scheduling module API */
export function initialize()
{
    mlog(log.INFO, null, `initializing Orchestra infrastructure`)

    const default_config = {
        /* A default configuration with:
         * - a sender-based slotframe for EB transmission
         * - a sender-based or receiver-based slotframe for unicast to RPL parents and children
         * - a common shared slotframe for any other traffic (mostly broadcast)
         *  */
        ORCHESTRA_RULES: [ "orchestra_rule_eb_per_time_source",
                           "orchestra_rule_unicast_per_neighbor_rpl_storing",
                           "orchestra_rule_default_common" ],
        /* Example configuration for the link based rule (the best for bidirectional traffic): */
        /* ORCHESTRA_RULES: [ "orchestra_rule_eb_per_time_source",
                              "orchestra_rule_unicast_per_neighbor_link_based",
                              "orchestra_rule_default_common" ], */
        /* Example configuration for RPL non-storing mode (works also for the storing one): */
        /* ORCHESTRA_RULES:  [ "orchestra_rule_eb_per_time_source",
                               "orchestra_rule_unicast_per_neighbor_rpl_ns",
                               "orchestra_rule_default_common" ], */

        /* Length of the various slotframes. Tune to balance network capacity,
         * contention, energy, latency. */
        ORCHESTRA_EBSF_PERIOD:                     397,
        ORCHESTRA_COMMON_SHARED_PERIOD:            31,
        ORCHESTRA_UNICAST_PERIOD:                  17,
        ORCHESTRA_ROOT_PERIOD:                     7,

        /* Is the per-neighbor unicast slotframe sender-based (if not, it is receiver-based).
         * Note: sender-based works only with RPL storing mode as it relies on DAO and
         * routing entries to keep track of children and parents. */
        ORCHESTRA_UNICAST_SENDER_BASED:            false,

        /* The hash function used to assign timeslot to a given node (based on its link-layer address).
         * For rules with multiple channel offsets, it is also used to select the channel offset. */
        ORCHESTRA_LINKADDR_HASH: function(addr) {
            return addr ? addr.u8[addr.u8.length - 1] : -1;
        },

        /* The hash function used to assign timeslot for a pair of given nodes. */
        ORCHESTRA_LINKADDR_HASH2: function(addr1, addr2) {
            return addr1.u8[addr1.u8.length - 1] + 264 * addr2.u8[addr2.u8.length - 1];
        },

        /* The maximum hash */
        ORCHESTRA_MAX_HASH:                        0x7fff,

        /* Is the "hash" function collision-free? (e.g. it maps to unique node-ids) */
        ORCHESTRA_COLLISION_FREE_HASH:             false,

        /* Channel offset for the EB rule */
        ORCHESTRA_EB_CHANNEL_OFFSET:               0,

        /* Channel offset for the default common rule */
        ORCHESTRA_DEFAULT_COMMON_CHANNEL_OFFSET:   1,

        /* Min and max channel offset for the unicast rules; the default min/max range is [2, 255] */
        ORCHESTRA_UNICAST_MIN_CHANNEL_OFFSET:      2,
        ORCHESTRA_UNICAST_MAX_CHANNEL_OFFSET:      255,
    };

    for (const key in default_config) {
        /* set the ones that have not been set from the config file */
        if (!config.hasOwnProperty(key)) {
            config[key] = default_config[key];
        }
    }

    /* Decide the slot type for the Orchestra common slotframe.
     * If there is a slotframe for EBs, use this slotframe for non-EB traffic only
     * If there is no slotframe for EBs, use this slotframe both EB and non-EB traffic
     */
    config.ORCHESTRA_COMMON_SHARED_TYPE =  config.ORCHESTRA_EBSF_PERIOD > 0 ?
        constants.CELL_TYPE_NORMAL :
        constants.CELL_TYPE_ADVERTISING;

    /* Decide the slot type for Tx slots.
     * If the schedule is sender based, the hash is collision free, and there are enough slots for all nodes,
     * make the Tx slots dedicated. Else, they are potentially shared between multiple nodes.
     */
    if (config.ORCHESTRA_UNICAST_SENDER_BASED
        && config.ORCHESTRA_COLLISION_FREE_HASH
        && config.ORCHESTRA_UNICAST_PERIOD > config.ORCHESTRA_MAX_HASH + 1) {
        config.ORCHESTRA_UNICAST_SLOT_SHARED_FLAG = 0;
    } else {
        config.ORCHESTRA_UNICAST_SLOT_SHARED_FLAG = constants.CELL_OPTION_SHARED;
    }

    orchestra_set_timings();
}
