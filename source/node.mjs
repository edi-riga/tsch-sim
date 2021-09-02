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
 *         Node class: the functionality of a network device
 * \author
 *         Atis Elsts <atis.elsts@edi.lv>
 */

import constants from './constants.mjs';
import config from './config.mjs';
import * as scheduler_orchestra from './scheduler_orchestra.mjs';
import * as scheduler_6tisch_min from './scheduler_6tisch_min.mjs';
import * as scheduler_lf from './scheduler_lf.mjs';
// Import new scheduler file
import * as scheduler_new from './scheduler_new.mjs';
import * as pkt from './packet.mjs';
import { dbm_to_mw, mw_to_dbm, assert, id_to_addr, get_hopseq,
         div_safe, round_to_ms } from './utils.mjs';
import { rng } from './random.mjs';
import * as log from './log.mjs';
import * as time from './time.mjs';
import * as neighbor from './neighbor.mjs';
import * as route from './route.mjs';
import * as rpl from './routing_rpl.mjs';
import * as nullrouting from './routing_null.mjs';
import * as lfrouting from './routing_lf.mjs';
// Import the new routing file
import * as routing_manual from './routing_manual.mjs'
import * as sf from './slotframe.mjs';
import * as simulator from './simulator.mjs';
import * as energy_model from './energy_model.mjs';

/* Select which scheduler to use */
let scheduler = scheduler_6tisch_min;
if (config.SCHEDULING_ALGORITHM === "Orchestra") {
    scheduler = scheduler_orchestra;
} else if (config.SCHEDULING_ALGORITHM === "LeafAndForwarder") {
    scheduler = scheduler_lf;
} else if (config.SCHEDULING_ALGORITHM == "NewScheduler") {
    scheduler = scheduler_new
}

/* ------------------------------------- */

export const SCHEDULE_DECISION_SLEEP = 0;
export const SCHEDULE_DECISION_TX    = 1;
export const SCHEDULE_DECISION_RX    = 2;
export const SCHEDULE_DECISION_SCAN  = 3;

const NUM_RECENT_LINK_LAYER_SEQNUMS = 16;

/* ------------------------------------- */

/* Network node */
export class Node {
    constructor(id, index, type_config, network) {
        this.id = id;
        this.sid = `${this.id}`;
        if (this.id < 10) {
            this.sid += ' ';
        }
        if (this.id < 100) {
            this.sid += ' ';
        }
        if (this.id < 1000) {
            this.sid += ' ';
        }
        assert(typeof(id) === "number", "node ID must be a number", this);
        assert(Math.round(id) === id, "node ID must be an integer", this);
        assert(id > 0, "node ID must be positive", this);
        this.addr = id_to_addr(id);
        this.index = index; /* in the network nodes map */
        this.config = type_config;
        this.network = network;
        this.slotframes = [];
        this.links = new Map(); /* keyed by destination */
        this.potential_links = new Map(); /* keyed by destination */
        /* dynamic state: location */
        this.pos_x = 0.0;
        this.pos_y = 0.0;
        /* dynamic state: joining */
        this.hopseq = get_hopseq(this.config.MAC_HOPPING_SEQUENCE);
        if (this.config.MAC_JOIN_HOPPING_SEQUENCE) {
            this.join_hopseq = get_hopseq(this.config.MAC_JOIN_HOPPING_SEQUENCE);
        } else {
            this.join_hopseq = get_hopseq(this.config.MAC_HOPPING_SEQUENCE);
        }
        this.is_coordinator = false;
        this.has_joined = false;
        this.scanning_timer = null;
        this.scanning_rx_cell = null;
        /* dynamic state: neighbors */
        this.neighbors = new Map(); /* packet queues and other state, one for each destination */
        /* add virtual EB and broadcast neighbors */
        this.neighbors.set(constants.EB_ID, new neighbor.Neighbor(this, constants.EB_ID));
        this.neighbors.set(constants.BROADCAST_ID, new neighbor.Neighbor(this, constants.BROADCAST_ID));
        this.current_time_source = null;
        /* dynamic state: packet Tx and Rx */
        this.tx_packet = null; /* temporary storage for packet that was sent, but not acked yet */
        this.rx_ok_packets = new Array(this.config.MAC_MAX_SUBSLOTS); /* packets just Rx'ed in this slot */
        this.rx_failed_packets = new Array(this.config.MAC_MAX_SUBSLOTS); /* packets potentially heard in this slot, but with errors */
        for (let i = 0; i < this.config.MAC_MAX_SUBSLOTS; ++i) {
            this.rx_ok_packets[i] = [];
            this.rx_failed_packets[i] = [];
        }
        this.is_any_packet_rx_in_subslot = false;
        this.selected_cell = null;
        /* dynamic state: EB and keepalives */
        this.eb_timer = null;
        this.keepalive_timer = null;
        this.leave_timer = null;
        this.current_eb_period = this.config.MAC_EB_PERIOD_S;
        this.join_priority = 0xff;
        /* dynamic state: sequence numbers */
        this.seqnum_generator = 0;
        /* make each node start with a different, random link-layer sequence number */
        this.link_layer_seqnum_generator = Math.trunc(rng.random() * 256);
        this.recent_link_layer_seqnums = [];
        /* dynamic state: 6LoWPAN fragmentation and reassembly */
        this.fragment_my_tag = 0; /* counter used to generate fragment tags */
        this.fragments_pending = {}; /* pending on the receiver side */
        /* Routing table */
        this.routes = new route.RoutingTable(this);
        /* Routing protocol state */
        if (this.config.ROUTING_ALGORITHM === "RPL") {
            this.routing = new rpl.RPL(this);
        } else if (this.config.ROUTING_ALGORITHM === "LeafAndForwarderRouting") {
            this.routing = new lfrouting.LeafAndForwarderRouting(this);
        } else if (this.config.ROUTING_ALGORITHM === "NullRouting") {
            this.routing = new nullrouting.NullRouting(this);
        } else if (this.config.ROUTING_ALGORITHM === "ManualRouting") {
            this.routing = new routing_manual.NewRouting(this);
        } else {
            this.log(log.ERROR, `failed to find routing algorithm "${this.config.ROUTING_ALGORITHM}", using NullRouting`);
            this.routing = new nullrouting.NullRouting(this);
        }
        /* optimization: keep the number of timeslots to skip cached for faster operation */
        this.timeslots_to_skip = 0;
        /* statistics */
        this.reset_stats();

        this.log(log.DEBUG, `created`);
    }

    initialize() {
        /* init the scheduler (e.g. Orchestra) slotframe infrastructure for each node */
        scheduler.node_init(this);

        if (this.id === constants.ROOT_NODE_ID) {
            this.set_coordinator(true);
        }
        this.reset_node(true);
    }

    reset_stats() {
        /* statistics: end-to-end */
        this.stats_app_packets_rxed = new Set(); /* for the destination */
        this.stats_app_packets_seen = new Set(); /* for all intermediate nodes */
        this.stats_app_num_tx = 0;
        this.stats_app_num_replied = 0;
        this.stats_app_num_endpoint_rx = 0;
        this.stats_app_num_queue_drops = 0;
        this.stats_app_num_tx_limit_drops = 0;
        this.stats_app_num_routing_drops = 0;
        this.stats_app_num_scheduling_drops = 0;
        this.stats_app_num_other_drops = 0;
        this.stats_app_latencies = [];
        /* statistics: TSCH protocol */
        this.stats_tsch_eb_tx = 0;
        this.stats_tsch_eb_rx = 0;
        this.stats_tsch_keepalive_tx = 0;
        this.stats_tsch_keepalive_rx = 0;
        /* statistics: link layer */
        this.stats_mac_tx = 0;
        this.stats_mac_tx_unicast = 0;
        this.stats_mac_acked = 0;
        this.stats_mac_rx = 0;
        this.stats_mac_rx_error = 0;
        this.stats_mac_rx_collision = 0;
        this.stats_mac_ack_error = 0;
        /* statistics: link layer, for the parent neighbor */
        this.stats_mac_parent_tx_unicast = 0; /* unicast only */
        this.stats_mac_parent_acked = 0;
        this.stats_mac_parent_rx = 0;
        /* statistics: slot usage */
        this.stats_slots_rx_idle = 0; // Number of idle slots
        this.stats_slots_rx_scanning = 0;
        // Dictionary objects
        this.stats_slots_rx_packet = {}; /* packet_size -> num_packets */
        this.stats_slots_rx_packet_tx_ack = {}; /* packet_size -> num_packets */
        this.stats_slots_tx_packet = {}; /* packet_size -> num_packets */
        this.stats_slots_tx_packet_rx_ack = {}; /* packet_size -> num_packets */
        // Total packet size, including data and header
        const max_packet_size = this.config.MAC_MAX_PACKET_SIZE + this.config.MAC_HEADER_SIZE;
        for (let i = 0; i <= max_packet_size; ++i) {
            // Reset values to 0
            this.stats_slots_rx_packet[i] = 0;
            this.stats_slots_rx_packet_tx_ack[i] = 0;
            this.stats_slots_tx_packet[i] = 0;
            this.stats_slots_tx_packet_rx_ack[i] = 0;
        }
        /* statistics: joining */
        this.stats_tsch_join_time_sec = null;
        this.stats_tsch_num_parent_changes = 0;
    }

    /* Reset node and TSCH state */
    reset_node(is_from_init) {
        this.cancel_syncing();
        if (this.config.MAC_START_JOINED) {
            log.log(log.INFO, this, "TSCH", `Node has joined TSCH [NODE]`);
            this.has_joined = true;
            if (!this.is_coordinator) {
                this.schedule_desync(this.config.MAC_KEEPALIVE_TIMEOUT_S, this.config.MAC_DESYNC_THRESHOLD_S);
            }
        } else {
            log.log(log.INFO, this, "TSCH", `Node has joined TSCH [NODE]`);
            this.has_joined = this.is_coordinator;
        }
        if (this.has_joined) {
            if (this.stats_tsch_join_time_sec == null) {
                this.stats_tsch_join_time_sec = round_to_ms(time.timeline.seconds);
            }
        }
        this.timeslots_to_skip = 0;
        // Reset queue and flush packets from each neighbor
        this.queue_reset();
        this.update_time_source(null);
        this.join_priority = this.is_coordinator ? 0 : 0xff;
        /* Forget past link statistics. If we are leaving a TSCH
           network, there are changes we've been out of sync in the recent past, and
           as a result have irrelevant link statistices. */
        this.reset_link_stats();
        /* RPL local repair */
        this.routing.local_repair(is_from_init);
        /* reset EB period */
        this.set_eb_period(this.config.MAC_EB_PERIOD_S);

        /* start scanning again (unless the node is the) */
        if (this.scanning_timer) {
            time.remove_timer(this.scanning_timer);
            this.scanning_timer = null;
        }
        if (!this.is_coordinator) {
            this.scanning_timer_cb();
        }
    }

    /*---------------------------------------------------------------------------*/

    /* Module logging */
    log(severity, msg) {
        log.log(severity, this, "Node", msg);
    }

    /* Get IEEE 802.15.4 channel from a TSCH channel offset */
    get_channel(channel_offset) {
        if (this.has_joined) {
            /* Calculate the physical channel from a channel offset using the algorithm from the IEEE 802.15.4 standard */
            return this.hopseq[(time.timeline.asn + channel_offset) % this.hopseq.length];
        }
        /* Simply return the current channel being scanned */
        return this.join_hopseq[channel_offset];
    }

    /* ------------------------------------------------------------- */

    set_coordinator(yes) {
        if (yes !== this.is_coordinator) {
            this.is_coordinator = yes;
            if (yes) {
                this.log(log.INFO, "becomes TSCH coordinator");
                this.start_coordinator();
            } else {
                this.log(log.INFO, "stops being TSCH coordinator");
                this.reset_node(false);
            }
        }
    }

    start_coordinator() {
        log.log(log.INFO, this, "TSCH", `Node has joined TSCH as coordinator [NODE]`);
        // Node has to join TSCH to become coordinator
        this.has_joined = true;
        this.cancel_syncing();
        if (this.stats_tsch_join_time_sec == null) {
            this.stats_tsch_join_time_sec = round_to_ms(time.timeline.seconds);
        }
        this.set_eb_period(this.config.MAC_EB_PERIOD_S);
        this.join_priority = 0;
        this.routing.start();
        
        scheduler.on_node_becomes_root(this);
    }

    set_eb_period(period) {
        this.current_eb_period = Math.min(period, this.config.MAC_MAX_EB_PERIOD_S);
        this.check_eb_timer();
    }

    /* Act on EB timer being expired */
    eb_timer_callback() {
        if (!this.has_joined) {
            log.log(log.DEBUG, this, "TSCH", `skip sending EB: not joined a TSCH network[NODE]`);
        } else if (this.current_eb_period <= 0) {
            log.log(log.DEBUG, this, "TSCH", `skip sending EB: EB period disabled[NODE]`);
        } else if (this.config.ROUTING_IS_LEAF) {
            log.log(log.DEBUG, this, "TSCH", `skip sending EB: in the leaf mode[NODE]`);
        } else if (!this.routing.is_joined()) {
            log.log(log.DEBUG, this, "TSCH", `skip sending EB: not joined a routing DAG[NODE]`);
        } else {
            const neighbor = this.neighbors.get(constants.EB_ID);
            /* Enqueue EB only if there isn't already one in queue */
            if (neighbor.has_packets()) {
                this.log(log.DEBUG, "skip sending EB: already queued[NODE]");
            } else {
                const packet = new pkt.Packet(this, constants.EB_ID, config.MAC_EB_PACKET_SIZE, true);
                packet.packet_protocol = constants.PROTO_TSCH;
                packet.packetbuf.PACKETBUF_ATTR_FRAME_TYPE = constants.FRAME802154_BEACONFRAME;
                packet.packetbuf.PACKETBUF_ATTR_JOIN_PRIORITY = this.join_priority;
                this.link_layer_seqnum = this.get_link_layer_seqnum(); /* TODO: is this needed? */
                log.log(log.DEBUG, this, "TSCH", "add a new EB packet");
                this.stats_tsch_eb_tx += 1;
                neighbor.push_packet(packet);
            }
        }

        /* Decide when to send the next EB  */
        let delay;
        if (this.current_eb_period > 0) {
            /* Next EB transmission with a random delay
             * within [tsch_current_eb_period*0.75, tsch_current_eb_period[ */
            delay = this.current_eb_period - this.current_eb_period / 4 + rng.uniform(0, this.current_eb_period / 4);
        } else if (this.config.MAC_EB_PERIOD_S > 0) {
            /* use the default configured EB period */
            delay = this.config.MAC_EB_PERIOD_S;
        } else {
            /* do not send EBs */
            delay = Infinity;
        }

        this.eb_timer = time.add_timer(delay, false, this, function(node) { node.eb_timer_callback(); });
    }

    /* Check whether the EB timer should be started/stopped. Called when node's state is updated */
    check_eb_timer() {
        const do_fire = this.has_joined && this.current_eb_period >= 0;
        if (do_fire && !this.eb_timer) {
            this.eb_timer = time.add_timer(this.is_coordinator ? 0 : rng.uniform(0, this.config.MAC_EB_PERIOD_S), false, this, function(node) { node.eb_timer_callback(); });
        } else if (!do_fire && this.eb_timer) {
            time.remove_timer(this.eb_timer);
            this.eb_timer = null;
        }
    }

    cancel_syncing() {
        if (this.keepalive_timer) {
            time.remove_timer(this.keepalive_timer);
            this.keepalive_timer = null;
        }
        if (this.leave_timer) {
            time.remove_timer(this.leave_timer);
            this.leave_timer = null;
        }
    }

    schedule_desync(keepalive_timeout, desynchronization_timeout) {
        /* reset keepalive timer */
        if (this.keepalive_timer) {
            time.remove_timer(this.keepalive_timer);
        }
        if (keepalive_timeout) {
            this.keepalive_timer = time.add_timer(keepalive_timeout, false, this, function(node) { node.keepalive_timer_cb(); });
        }
        /* reset desynchronization timer */
        if (this.leave_timer) {
            time.remove_timer(this.leave_timer);
        }
        if (desynchronization_timeout) {
            this.leave_timer = time.add_timer(desynchronization_timeout, false, this, function(node) {
                node.leave_network();
            });
        }
    }

    keepalive_timer_cb() {
        this.keepalive_timer = null;

        if (this.current_time_source) {
            this.log(log.INFO, `send keepalive packet to=${this.current_time_source.id}[NODE]`);

            /* add an empty packet (only headers, no payload) */
            const packet = new pkt.Packet(this, this.current_time_source.id, this.config.MAC_HEADER_SIZE, true);
            packet.packet_protocol = constants.PROTO_TSCH;
            // Sent function to be called when the packet is sent successfully
            packet.sent_callback = function(packet, is_success) {
                packet.source.keepalive_packet_sent(packet, is_success);
            }
            this.add_packet(packet);
        }

        /* schedule the new one immediately, without waiting for sending to complete */
        if (this.config.MAC_KEEPALIVE_TIMEOUT_S) {
            this.keepalive_timer = time.add_timer(this.config.MAC_KEEPALIVE_TIMEOUT_S, false, this, function(node) {
                node.keepalive_timer_cb();
            });
        }
    }

    keepalive_packet_sent(packet, is_success) {
        this.stats_tsch_keepalive_tx += 1;
        if (is_success) {
            this.log(log.DEBUG, `keepalive packet sent: ok, to=${packet.destination_id}[NODE]`);
            /* leave? */
        } else {
            this.log(log.INFO, `keepalive packet sent: failed, to=${packet.destination_id}[NODE]`);
        }
    }

    leave_network() {
        this.leave_timer = null;
        this.log(log.WARNING, `leaving network, did not resynchronize with the time source for seconds=${this.config.MAC_DESYNC_THRESHOLD_S}[NODE]`);
        this.reset_node(false);
    }

    /* Act on the scanning timer being expired: switch channels if needed */
    scanning_timer_cb() {
        if (this.has_joined) {
            this.scanning_timer = null;
            return;
        }
        
        const channel_offset = rng.randint(0, this.join_hopseq.length);
        const period = this.config.MAC_CHANNEL_SCAN_DURATION_SEC;
        if (!this.scanning_rx_cell || this.scanning_rx_cell.channel_offset !== channel_offset) {
            this.log(log.INFO, `scanning on channel=${this.join_hopseq[channel_offset]}...[NODE]`);
            // Add new cell at the location being scanned
            this.scanning_rx_cell = new sf.Cell(0, channel_offset, this, constants.CELL_OPTION_RX);
        }
        this.scanning_timer = time.add_timer(period, false, this, function(node) { node.scanning_timer_cb(); });
    }

    ensure_neighbor(neighbor_id) {
        assert(neighbor_id, "neighbor_id must be set");
        assert(neighbor_id != this.id, "node cannot be a neighbor to itself");
        if (!this.neighbors.has(neighbor_id)) {
            this.log(log.INFO, `add neighbor id=${neighbor_id} [NODE]`);
            this.neighbors.set(neighbor_id, new neighbor.Neighbor(this, neighbor_id));
            /* if using a simple routing method, add a route to the neighbor via itself */
            if (this.config.ROUTING_ALGORITHM !== "RPL") {
                log.log(log.INFO, this, "Node", `Add_route called from ensure neighbor`);
                // DISABLE THE FOLLOWING LINE TO CHECK THE ROUTES.JSON FUNCTIONALITY
                // this.add_route(neighbor_id, neighbor_id);
            }
        }
        return this.neighbors.get(neighbor_id);
    }

    reset_link_stats() {
        for (const [_, neighbor] of this.neighbors) {
            neighbor.reset_neighbor();
        }
    }

    /* ------------------------------------------------------------- */

    /* Add a new slotframe to this node */
    add_slotframe(handle, rule_name, size) {
        const slotframe = new sf.Slotframe(this, handle, rule_name, size);
        this.slotframes.push(slotframe);
        log.log(log.INFO, this, "Node", `Slotframe number ${this.slotframes.length} added from node: ${this.id} [NODE]`);
        return slotframe;
    }

    /* Add a new cell to a given slotframe */
    add_cell(slotframe, type, options, neighbor_id, timeslot, channel_offset, keep_old) {
        /* add a new cell to the slotframe */
        log.log(log.INFO, this, "Node", `Add cell in timeslot: ${timeslot} channel offset: ${channel_offset} in slotframe: ${this.slotframes.length}`);
        let result = slotframe.add_cell(type, options, neighbor_id, timeslot, channel_offset, keep_old);
        // log.log(log.INFO, this, "Node", `cell added to Slotframe [NODE]`);
        /* make sure there is a neighbor with a queue for this cell */
        this.ensure_neighbor(neighbor_id);
        return result;
    }

    /* Add multiple new cells in a specific timeslot range to a given slotframe */
    add_multi_cell(slotframe, type, options, neighbor_id, timeslot_from, timeslot_count, channel_offset) {
        /* simply add a cell for each for of the timeslots in range */
        this.log(log.DEBUG, `add multi cell from=${timeslot_from} count=${timeslot_count} offset=${channel_offset}[NODE]`);
        let total_count = 0
        for (let ts = timeslot_from; ts < timeslot_from + timeslot_count; ++ts) {
            this.add_cell(slotframe, type, options, neighbor_id, ts, channel_offset);
            total_count += 1;
        }
        log.log(log.INFO, this, "Node", `Add multi cell called adding ${total_count}`);

    }

    /* Get the first cell at a specific timeslot and channel offset */
    get_cell(slotframe, timeslot, channel_offset) {
        return slotframe.get_cell(timeslot, channel_offset);
    }

    /* Remove all cells at a specific timeslot */
    remove_cell_by_timeslot(slotframe, timeslot) {
        return slotframe.remove_cell_by_timeslot(timeslot);
    }

    /* Remove all cells at a specific timeslot and channel offset */
    remove_cell_by_timeslot_and_co(slotframe, timeslot, channel_offset) {
        return slotframe.remove_cell_by_timeslot_and_co(timeslot, channel_offset);
    }

    /* Remove a given cell */
    remove_cell(slotframe, cell) {
        if (!cell) {
            return false;
        }
        return slotframe.remove_cell_by_timeslot_and_co(cell.timeslot, cell.channel_offset);
    }

    /* ------------------------------------------------------------- */

    /* May the neighbor transmit over a shared link? */
    queue_backoff_expired(neighbor) {
        return neighbor.backoff_window === 0;
    }

    /* Reset neighbor backoff */
    queue_backoff_reset(neighbor) {
        neighbor.backoff_window = 0;
        neighbor.backoff_exponent = this.config.MAC_MIN_BE;
        log.log(log.DEBUG, this, "TSCH", `reset backoff exponent=${neighbor.backoff_exponent}[NODE]`);
    }

    /* Increment backoff exponent, pick a new window */
    queue_backoff_inc(neighbor) {
        /* Increment exponent */
        neighbor.backoff_exponent = Math.min(neighbor.backoff_exponent + 1, this.config.MAC_MAX_BE);
        log.log(log.DEBUG, this, "TSCH", `set backoff exponent=${neighbor.backoff_exponent}[NODE]`);
        /* Pick a window (number of shared slots to skip) */
        neighbor.backoff_window = rng.randint(0, 65536) % (1 << neighbor.backoff_exponent);
        /* Add one to the window as we will decrement it at the end of the current slot
         * through queue_update_all_backoff_windows */
        neighbor.backoff_window += 1;
    }

    /* Decrement backoff window for all queues directed at the cell's neighbor ID */
    queue_update_all_backoff_windows(cell) {
        const is_broadcast = (cell.neighbor_id === constants.BROADCAST_ID);
        for (const [id, neighbor] of this.neighbors) {
            if (neighbor.backoff_window !== 0 /* Is the queue in backoff state? */
               && ((neighbor.tx_cells_count === 0 && is_broadcast)
                   || (neighbor.tx_cells_count > 0 && cell.neighbor_id === id))) {
                neighbor.backoff_window--;
            }
        }
    }

    /* Flush a neighbor queue */
    queue_flush_nbr_queue(neighbor) {
        for (let packet of neighbor.queue) {
            this.log(log.WARNING, `! flushing packet source: ${packet.source.id} destination: ${packet.destination_id} seqnum: ${packet.seqnum} [NODE]`);
            /* Call packet_sent callback */
            this.packet_sent(packet, neighbor, false, null);
        }
        neighbor.queue = [];
    }

    /* Flush all neighbor queues */
    queue_reset() {
        for (const [_, neighbor] of this.neighbors) {
            /* Flush queue */
            this.queue_flush_nbr_queue(neighbor);
            /* Reset backoff exponent */
            this.queue_backoff_reset(neighbor);
        }
    }

    /* Returns the first packet from a neighbor queue */
    queue_get_packet_for_nbr(neighbor_id, cell) {
        assert(cell, "cell must be set");
        const neighbor = this.neighbors.get(neighbor_id);
        const is_shared_cell = cell.options & constants.CELL_OPTION_SHARED;
        /* If this is a shared cell, make sure the backoff has expired */
        if (is_shared_cell && !this.queue_backoff_expired(neighbor)) {
            return null;
        }
        // Get the most recent packet in queue
        if (neighbor.has_packets()) {
            return this.filter_packet(neighbor.queue[0], cell);
        }
        return null;
    }

    update_time_source(new_time_source) {
        log.log(log.INFO, this, "Node", `update time source called [NODE]`);
        if (new_time_source !== this.current_time_source) {
            // Add a parent change
            this.stats_tsch_num_parent_changes += 1;
            // Move the current time source as the old time source
            const old_time_source = this.current_time_source;

            // Define the specified node as the new time source
            if (old_time_source) {
                old_time_source.is_time_source = false;
            }
            if (new_time_source) {
                new_time_source.is_time_source = true;
            }
            // Change the current time source
            this.current_time_source = new_time_source;
            
            /* update the routing module */
            this.routing.on_new_time_source(old_time_source, new_time_source);
            
            /* update the scheduler */
            scheduler.on_new_time_source(this, old_time_source, new_time_source);
        }
    }

    /* called from the routing module */
    on_parent_switch(old_parent, new_parent) {
        /* Map the TSCH time source on the RPL preferred parent (but stick to the
         * current time source if there is no preferred aarent) */
        if (this.has_joined) {
            this.update_time_source(new_parent);
        }
    }

    on_new_dio_interval(dio_interval, rank, is_root) {
        /* Transmit EBs only if we have a valid rank as per 6TiSCH minimal */
        if (rank != 0xFF) {
            /* If we are root set TSCH as coordinator */
            if (is_root) {
                this.set_coordinator(true);
            }
            /* Set EB period */
            this.set_eb_period(dio_interval);
            /* Set join priority based on RPL rank */
            this.join_priority = rank - 1;
        } else {
            this.set_eb_period(this.config.MAC_EB_PERIOD_S);
        }
    }

    // Add route to the routing table [keep the next hop for the destination]
    add_route(destination_id, nexthop_id) {
        // gets the route to the specified destination if
        let route = this.routes.get_route(destination_id);
        
        if (route) {
            // The value for next hop in the routing table for the node is the same as the next hop for the route to be added, then return the route from the routing table, else update the previously stored route and remove
            if (route.nexthop_id === nexthop_id) {
                return route;
            }
            // Remove the old route
            this.routes.remove_route(destination_id);
            if (route.is_direct()) {
                // Call the event handler in case a route is removed
                scheduler.on_child_removed(this, id_to_addr(destination_id));
            }
        }

        // Add the updated route
        route = this.routes.add_route(destination_id, nexthop_id);
        
        // is_direct() method returns true if the destination id is the same as the next hop id
        if (route.is_direct()) {
            scheduler.on_child_added(this, id_to_addr(destination_id));
        }

        // log.log(log.INFO, this, "Node", `Route added to destination node id: ${destination_id} through next hop node id: ${nexthop_id} for in the routing table of node: ${this.id}`)
        return route;
    }

    remove_route(destination_id) {
        const route = this.routes.get_route(destination_id);
        if (route) {
            this.routes.remove_route(destination_id);
            if (route.is_direct()) {
                scheduler.on_child_removed(this, id_to_addr(destination_id));
            }
        }
    }

    /* ------------------------------------------------------------- */

    /* Add an application-layer packet to the node */
    add_app_packet(packet) {
        packet.packet_protocol = constants.PROTO_APP;
        this.stats_app_num_tx += 1;
        return this.add_packet(packet);
    }

    /* Add a network-layer packet to the node */
    add_packet(packet) {

        // No nexthop id set for the packet from node
        if (packet.nexthop_id == null) {
            if (packet.packet_protocol === constants.PROTO_APP) {
                log.log(log.INFO, this, "App", `dropping app packet seqnum=${packet.seqnum} for=${packet.destination_id}: no route`);
                packet.source.stats_app_num_routing_drops += 1;
                log.log(log.INFO, this, "App", `Number of packet drops: ${packet.source.stats_app_num_routing_drops}`);
            } else {
                this.log(log.DEBUG, `dropping packet seqnum=${packet.seqnum} for=${packet.destination_id}: no route`);
            }
            this.packet_sent(packet, null, false, null);
            return null;
        }

        if (packet.destination_id === this.id) {
            /* emulate a loopback interface */
            this.log(log.DEBUG, `looping back a packet`);
            this.rx_packet_network_layer(packet);
            this.packet_sent(packet, null, true, null);
            return null;
        }

        if (!this.has_joined) {
            if (packet.packet_protocol === constants.PROTO_APP) {
                log.log(log.INFO, this, "App", `dropping app packet seqnum=${packet.seqnum} for=${packet.destination_id} to=${packet.nexthop_id}: not associated`);
                packet.source.stats_app_num_other_drops += 1;
            } else {
                this.log(log.DEBUG, `dropping packet seqnum=${packet.seqnum} for=${packet.destination_id} to=${packet.nexthop_id}: not associated`);
            }
            this.packet_sent(packet, null, false, null);
            return null;
        }

        /* can attempt to send. do fragmentation first, if required */
        if (packet.length > this.config.MAC_MAX_PACKET_SIZE) {
            if (this.config.IP_FRAGMENTATION_ENABLED) {
                /* send fragments */
                return this.fragment_packet(packet);
            } else {
                /* fragmentation not enabled, drop the packet */
                if (packet.packet_protocol === constants.PROTO_APP) {
                    log.log(log.INFO, this, "App", `dropping app packet seqnum=${packet.seqnum} for=${packet.destination_id} to=${packet.nexthop_id}: too big`);
                    packet.source.stats_app_num_other_drops += 1;
                } else {
                    this.log(log.INFO, `dropping packet seqnum=${packet.seqnum} for=${packet.destination_id} to=${packet.nexthop_id}: too big`);
                }
                this.packet_sent(packet, null, false, null);
                return null;
            }
        }

        /* make sure there is a neighbor queue for this packet */
        const neighbor = this.ensure_neighbor(packet.nexthop_id);

        // If on_packet_ready does not return any values
        if (!scheduler.on_packet_ready(this, packet)) {
            /* There is no matching slotframe in which to send the packet  */
            if (packet.packet_protocol === constants.PROTO_APP) {
                log.log(log.INFO, this, "App", `dropping app packet seqnum=${packet.seqnum} for=${packet.destination_id} to=${packet.nexthop_id}: no cell in the schedule[NODE]`);
                packet.source.stats_app_num_scheduling_drops += 1;
            } else {
                this.log(log.DEBUG, `dropping packet seqnum=${packet.seqnum} for=${packet.destination_id} to=${packet.nexthop_id}: no cell in the schedule[NODE]`);
            }
            this.packet_sent(packet, neighbor, false, null);
            return null;
        }

        this.routing.on_prepare_tx_packet(packet);

        if (neighbor.get_queue_size() >= this.config.MAC_QUEUE_SIZE) {
            /* the queue would get too big  */
            this.log(log.DEBUG, `dropping packet ${packet.seqnum} as queue full`);
            if (packet.packet_protocol === constants.PROTO_APP) {
                log.log(log.INFO, this, "App", `dropping app packet seqnum=${packet.seqnum} for=${packet.destination_id} to=${packet.nexthop_id}: queue full[NODE]`);
                packet.source.stats_app_num_queue_drops += 1;
            } else {
                this.log(log.DEBUG, `dropping packet seqnum=${packet.seqnum} for=${packet.destination_id} to=${packet.nexthop_id}: queue full[NODE]`);
            }
            this.packet_sent(packet, neighbor, false, null);
            return null;
        }

        /* OK, this packet can be sent out wirelessly */
        packet.hopcount += 1;

        /* add space for headers */
        packet.length += this.config.MAC_HEADER_SIZE;

        packet.link_layer_seqnum = this.get_link_layer_seqnum();

        /* add to the right queue */
        neighbor.push_packet(packet);

        if (packet.fragment_info) {
            this.log(log.DEBUG, `packet fragment=${packet.fragment_info.number} seqnum=${packet.seqnum} to=${packet.nexthop_id} for=${packet.destination_id} added, queue_free=${neighbor.get_queue_space()}`);
        } else {
            this.log(log.DEBUG, `packet seqnum=${packet.seqnum} to=${packet.nexthop_id} for=${packet.destination_id} added, queue_free=${neighbor.get_queue_space()}`);
        }

        return packet;
    }

    /* Split a network layer packet that is too large to be sent in fragment, return the first fragment */
    fragment_packet(packet) {
        this.fragment_my_tag += 1;
        this.log(log.DEBUG, `fragmenting packet, length=${packet.length} max=${this.config.MAC_MAX_PACKET_SIZE}`);

        const num_fragments = Math.ceil(packet.length / this.config.MAC_MAX_PACKET_SIZE);
        let first_fragment = null;
        let length_so_far = 0;
        for (let i = 0; i < num_fragments; ++i) {
            /* copy and update the fragment */
            let fragment = new pkt.Packet(this, -1, packet.length);
            fragment.copy(packet);
            fragment.fragment_info = new pkt.FragmentInfo(this.fragment_my_tag);
            fragment.fragment_info.number = i;
            fragment.fragment_info.total_fragments = num_fragments;
            if (i === num_fragments - 1) {
                fragment.length = packet.length - length_so_far;
            } else {
                fragment.length = this.config.MAC_MAX_PACKET_SIZE;
                length_so_far += fragment.length;
            }

            /* queue the fragment */
            fragment = this.add_packet(fragment);
            if (i === 0) {
                first_fragment = fragment;
            }
        }
        return first_fragment;
    }

    /* Get the LL seqnum to use in the next packet */
    get_link_layer_seqnum() {
        /* update link layer seqnum */
        this.link_layer_seqnum_generator = (this.link_layer_seqnum_generator + 1) % 256;
        if (this.link_layer_seqnum_generator === 0) {
            /* do not allow the seqnum to become zero */
            this.link_layer_seqnum_generator++;
        }
        return this.link_layer_seqnum_generator;
    }

    /* Has a packet with a specific LL seqnum seen recently from a specific node? */
    ll_seqnum_is_seen_recently(ll_seqnum, from_id) {
        const s = from_id + "#" + ll_seqnum;
        for (let i = 0; i < this.recent_link_layer_seqnums.length; ++i) {
            if (this.recent_link_layer_seqnums[i] === s) {
                return true;
            }
        }

        /* TODO: check reception time! */
        if (this.recent_link_layer_seqnums.length >= NUM_RECENT_LINK_LAYER_SEQNUMS) {
            /* make space for the new seqnum */
            this.recent_link_layer_seqnums.shift();
        }
        this.recent_link_layer_seqnums.push(s);
        return false;
    }

    /* Receive a network-layer packet fragment on the node */
    rx_fragment(packet) {
        const key = packet.source.id + "#" + packet.fragment_info.tag;
        let reassembly_info = this.fragments_pending[key];
        if (reassembly_info === undefined) {
            /* add new reassembly info */
            log.log(log.INFO, this, "Main", `packet reassembly started, seqnum=${packet.seqnum} from=${packet.source.id}[NODE]`);
            reassembly_info = {};
            reassembly_info[packet.fragment_info.number] = packet;
            reassembly_info.timer = time.add_timer(this.config.IP_REASSEMBLY_TIMEOUT_SEC, false, this, function(node) { node.reassembly_timeout(key); });
            this.fragments_pending[key] = reassembly_info;
        } else {
            /* add to existing reassembly info and check if completed */
            reassembly_info[packet.fragment_info.number] = packet;
            let total_length = 0;
            let all_present = true;
            for (let i = 0; i < packet.fragment_info.total_fragments; ++i) {
                if (reassembly_info[i] === undefined) {
                    all_present = false;
                    break;
                }
                total_length += reassembly_info[i].length;
            }
            if (all_present) {
                /* reassembly done; clean up and receive the complete packet */
                log.log(log.INFO, this, "Main", `packet reassembly completed, seqnum=${packet.seqnum} from=${packet.source.id}[NODE]`);
                time.remove_timer(reassembly_info.timer);
                delete this.fragments_pending[key];
                packet.length = total_length;
                packet.fragment_info = null;
                this.rx_packet_network_layer(packet);
            }
        }
    }

    reassembly_timeout(key) {
        log.log(log.WARNING, this, "Main", `packet reassembly timeout[NODE]`);
        const reassembly_info = this.fragments_pending[key];
        assert(reassembly_info !== undefined, `reassembly context not found, key=${key}[NODE]`);
        delete this.fragments_pending[key];
    }

    /* Receive a network-layer packet on the node */
    rx_packet_network_layer(packet) {

        if (packet.fragment_info) {
            this.rx_fragment(packet);
            return;
        }

        if (packet.destination_id === this.id || packet.destination_id === constants.BROADCAST_ID) {
            if (packet.packet_protocol !== constants.PROTO_APP) {
                /* special logic if this is not an application-layer data packet, but rather a protocol (TSCH/RPL) control packet */
                if (packet.packet_protocol === constants.PROTO_TSCH) {
                    /* TSCH keepalive packet, ignore it */
                    this.stats_tsch_keepalive_rx += 1;
                    return;
                }
                const callback = this.network.get_protocol_handler(packet.packet_protocol, packet.msg_type);
                if (callback) {
                    callback(this, packet);
                } else {
                    log.log(log.WARNING, this, "Main", `no handler for protocol=${packet.packet_protocol}[NODE]`);
                }
                return;
            }

            /* receive the application layer end-to-end packet */
            const effective_source = (packet.query_status == constants.PACKET_IS_RESPONSE ? this : packet.source);
            const seqnum = effective_source.id + "#" + packet.seqnum;
            if (this.stats_app_packets_rxed.has(seqnum)) {
                log.log(log.WARNING, this, "App", `rx duplicate app packet seqnum=${packet.seqnum} from=${packet.source.id}[NODE]`);
            } else {
                this.stats_app_packets_rxed.add(seqnum);

                if (packet.query_status == constants.PACKET_IS_REQUEST) {
                    /* only half-way done! send it back to the source before adding to PDR and latency statistics */
                    log.log(log.INFO, this, "App", `rx app request seqnum=${packet.seqnum} from=${effective_source.id}, sending response[NODE]`);
                    this.send_reply(packet);
                } else {
                    /* account for the end-to-end packet */
                    if (packet.query_status == constants.PACKET_IS_RESPONSE) {
                        log.log(log.INFO, this, "App", `rx app response seqnum=${packet.seqnum} from=${packet.source.id}[NODE]`);
                    } else {
                        log.log(log.INFO, this, "App", `rx app packet seqnum=${packet.seqnum} from=${effective_source.id} at cell [ts: ${packet.packetbuf.PACKETBUF_ATTR_TSCH_TIMESLOT}, co: ${packet.packetbuf.PACKETBUF_ATTR_TSCH_CHANNEL_OFFSET}][NODE]`);
                    }
                    /* update the stats of the original source, unless it is query response */
                    effective_source.stats_app_num_endpoint_rx += 1;
                    const latency = round_to_ms(time.timeline.seconds - packet.generation_time_s);
                    effective_source.stats_app_latencies.push(latency);
                }
            }
        } else {
            /* try to route it further */
            this.forward_packet(packet);
        }
    }

    /* Receive EB packet */
    rx_eb(packet) {

        /* update the neighbor structure */
        this.ensure_neighbor(packet.lasthop_id);
        this.neighbors.get(packet.lasthop_id).on_rx(packet);

        const join_priority = packet.packetbuf.PACKETBUF_ATTR_JOIN_PRIORITY;

        if (!this.has_joined) {
            this.tsch_associate(packet);
            /* account for EBs only when associated */
            if (this.has_joined) {
                this.stats_tsch_eb_rx += 1;
            }
            if (join_priority === 0) {
                /* from the coordinator */
                scheduler.add_root(this, packet.lasthop_id);
            }
            return;
        }

        /* account for EBs only when associated */
        this.stats_tsch_eb_rx += 1;

        if (join_priority >= this.config.MAC_MAX_JOIN_PRIORITY) {
            /* Join priority unacceptable. Leave network. */
            log.log(log.WARNING, this, "TSCH", `EB join priority too high (${join_priority}), leaving the network[NODE]`);
            this.reset_node(false);
            return;
        }

        if (join_priority === 0) {
            /* from the coordinator */
            scheduler.add_root(this, packet.lasthop_id);
        }
    }

    /* Attempt to associate to a network from an incoming EB */
    tsch_associate(eb) {
        // Increase the JP value everytime a node plans to associate with the tsch network using an EB
        const join_priority = eb.packetbuf.PACKETBUF_ATTR_JOIN_PRIORITY + 1;
        if (join_priority >= this.config.MAC_MAX_JOIN_PRIORITY) {
            /* too high JP */
            log.log(log.WARNING, this, "TSCH", `EB join priority too high (${join_priority}), not joining[NODE]`);
            return;
        }

        const source = this.neighbors.get(eb.lasthop_id);
        const sec = time.timeline.seconds;

        log.log(log.INFO, this, "TSCH", `joined/associated at ${round_to_ms(sec)} on receiving an EB packet from ${eb.lasthop_id}[NODE]`);
        this.join_priority = join_priority;
        log.log(log.INFO, this, "TSCH", `Node has joined TSCH in TSCH Associate [NODE]`);
        this.has_joined = true;
        if (this.stats_tsch_join_time_sec == null) {
            this.stats_tsch_join_time_sec = round_to_ms(time.timeline.seconds);
        }

        // Update time source for the receiver of the EB packet
        this.update_time_source(source);

        /* schedule the first keepalive at half the usual time to make drift learning faster */
        this.schedule_desync(this.config.MAC_KEEPALIVE_TIMEOUT_S / 2, this.config.MAC_DESYNC_THRESHOLD_S);

        time.remove_timer(this.scanning_timer);
        this.scanning_timer = null;
        this.scanning_rx_cell = null;

        /* start sending EB, if needed */
        this.check_eb_timer();

        /* start RPL operation */
        this.routing.start();

        /* do nothing else: time drifting is not implemented */
    }

    /* Returns true if the packet needs to be acked */
    rx_packet_link_layer(packet, cell, schedule_status) {
        this.stats_mac_rx += 1;
        /* rx from parent? */
        if (this.current_time_source
            && this.current_time_source.id === packet.lasthop_id) {
            this.stats_mac_parent_rx += 1;
        }

        schedule_status[this.index].flags |= constants.FLAG_PACKET_RX;
        schedule_status[this.index].from = packet.lasthop_id;
        schedule_status[this.index].to = packet.nexthop_id;
        schedule_status[this.index].l = packet.length;

        if (packet.packetbuf.PACKETBUF_ATTR_FRAME_TYPE === constants.FRAME802154_BEACONFRAME) {
            log.log(log.DEBUG, this, "TSCH", `rx EB from ${packet.lasthop_id}[NODE]`);
            this.rx_eb(packet);
            return true;
        }

        if (!this.has_joined) {
            this.log(log.DEBUG, `rx packet from ${packet.lasthop_id}: not associated![NODE]`);
            return false;
        }

        /* this slot was not idle */
        this.stats_slots_rx_idle -= 1;

        if (packet.nexthop_id > 0 && packet.nexthop_id !== this.id) {
            /* received the link-layer packet, but it was not for me */
            /* TODO: add a stats entry for this! */

            this.stats_slots_rx_packet[packet.length] += 1;
            this.log(log.DEBUG, `rx packet from ${packet.lasthop_id}: not for me![NODE]`);
            return false;
        }

        this.log(log.DEBUG, `rx packet from ${packet.lasthop_id}: seqnum=${packet.seqnum}[NODE]`);

        /* update the slot stats; if an ACK is required, at this point we know it will be sent */
        if (packet.is_ack_required) {
            this.stats_slots_rx_packet_tx_ack[packet.length] += 1;
        } else {
            this.stats_slots_rx_packet[packet.length] += 1;
        }

        /* update the neighbor structure */
        const neighbor = this.ensure_neighbor(packet.lasthop_id);
        neighbor.on_rx(packet);

        if (neighbor.is_time_source) {
            /* Got packet from time source, reset keepalive timer */
            this.log(log.DEBUG, `time resynchronized: got a packet from the time source[NODE]`);
            this.schedule_desync(this.config.MAC_KEEPALIVE_TIMEOUT_S, this.config.MAC_DESYNC_THRESHOLD_S);
        }

        /* look at the link layer seqnum and ignore duplicated packets at this point */
        if (!this.ll_seqnum_is_seen_recently(packet.link_layer_seqnum, packet.lasthop_id)) {
            // Packet received and moves up the layers
            this.rx_packet_network_layer(packet);
        }

        return true;
    }

    /* Reply to a query packet */
    send_reply(packet) {
        const new_packet = new pkt.Packet(this, -1, packet.length);
        new_packet.copy(packet);
        new_packet.source = this;
        new_packet.destination_id = packet.source.id;
        new_packet.query_status = constants.PACKET_IS_RESPONSE;
        new_packet.lasthop_id = this.id;
        new_packet.nexthop_id = this.routes.get_nexthop(packet.source.id);
        if (new_packet.nexthop_id <= 0) {
            new_packet.nexthop_addr = null;
        } else {
            new_packet.nexthop_addr = id_to_addr(new_packet.nexthop_id);
        }
        /* remove the headers */
        new_packet.length = packet.length - this.config.MAC_HEADER_SIZE;

        this.stats_app_num_replied += 1;
        if (this.add_packet(new_packet)) {
            this.log(log.DEBUG, `reply to packet ${packet.seqnum} to=${packet.source.id} via=${new_packet.nexthop_id}[NODE]`);
        }
    }

    /* Forward a network layer packet to a neighbor */
    forward_packet(packet) {
        if (this.config.ROUTING_IS_LEAF) {
            this.log(log.DEBUG, `leaf mode, not forwarding packet to=${packet.nexthop_id}[NODE]`);
            return;
        }

        const new_packet = new pkt.Packet(this, -1, packet.length);
        new_packet.copy(packet);
        new_packet.lasthop_id = this.id;
        new_packet.lasthop_addr = this.addr;
        new_packet.nexthop_id = this.routes.get_nexthop(packet.destination_id);
        if (new_packet.nexthop_id <= 0) {
            new_packet.nexthop_addr = null;
        } else {
            new_packet.nexthop_addr = id_to_addr(new_packet.nexthop_id);
        }
        /* remove the headers */
        new_packet.length = packet.length - this.config.MAC_HEADER_SIZE;

        if (!this.routing.on_forward(packet, new_packet)) {
            if (packet.packet_protocol === constants.PROTO_APP) {
                log.log(log.INFO, this, "App", `dropping app packet seqnum=${packet.seqnum} for=${packet.destination_id}: routing loop detected[NODE]`);
                packet.source.stats_app_num_routing_drops += 1;
            } else {
                this.log(log.DEBUG, `dropping packet seqnum=${packet.seqnum} for=${packet.destination_id}: routing loop detected[NODE]`);
            }
            return;
        }

        if (this.add_packet(new_packet)) {
            this.log(log.DEBUG, `forward packet ${packet.seqnum} from=${packet.source.id} to=${new_packet.nexthop_id}[NODE]`);
        }
    }

    /* Returns `packet` if the packet can be sent on the `cell`; else return null */
    filter_packet(packet, cell) {
        if (packet.packetbuf.hasOwnProperty("PACKETBUF_ATTR_TSCH_SLOTFRAME")
            && packet.packetbuf.PACKETBUF_ATTR_TSCH_SLOTFRAME !== 0xffffffff) {
            /* check if the slotframe matches */
            if (cell.slotframe.handle !== packet.packetbuf.PACKETBUF_ATTR_TSCH_SLOTFRAME) {
                /* log.log(log.DEBUG, this, "TSCH", `filtered out packet by sf: ${cell.slotframe.handle} vs ${packet.packetbuf.PACKETBUF_ATTR_TSCH_SLOTFRAME}`); */
                return null;
            }
        }
        if (packet.packetbuf.hasOwnProperty("PACKETBUF_ATTR_TSCH_TIMESLOT")
            && packet.packetbuf.PACKETBUF_ATTR_TSCH_TIMESLOT !== 0xffffffff) {
            /* check if the timeslot matches */
            if (cell.timeslot !== packet.packetbuf.PACKETBUF_ATTR_TSCH_TIMESLOT) {
                /* log.log(log.DEBUG, this, "TSCH", `filtered out packet by ts: ${cell.timeslot} vs ${packet.packetbuf.PACKETBUF_ATTR_TSCH_TIMESLOT}`); */
                return null;
            }
        }

        /* log.log(log.DEBUG, this, "TSCH", "packet passed the SF filters"); */
        return packet;
    }

    /* ------------------------------------------------------------- */

    /* Get a packet to send for a Tx cell */
    get_packet_for_tx_cell(cell) {
        if (!(cell.options & constants.CELL_OPTION_TX)) {
            return null;
        }

        if (cell.type === constants.CELL_TYPE_ADVERTISING
            || cell.type === constants.CELL_TYPE_ADVERTISING_ONLY) {
            /* fetch EB packets */
            const packet = this.queue_get_packet_for_nbr(constants.EB_ID, cell);
            if (packet != null) {
                const channel = this.get_channel(cell.channel_offset);
                log.log(log.DEBUG, this, "TSCH", `will tx an EB packet on channel ${channel}[NODE]`);
                return packet;
            }
            if (cell.type === constants.CELL_TYPE_ADVERTISING_ONLY) {
                return null;
            }
        }

        /* select a packet explicitly for the cell's destination */
        const packet = this.queue_get_packet_for_nbr(cell.neighbor_id, cell);
        if (packet != null) {
            if (cell.neighbor_id === constants.BROADCAST_ID) {
                log.log(log.DEBUG, this, "TSCH", `tx a broadcast packet[NODE]`);
            } else {
                log.log(log.DEBUG, this, "TSCH", `tx a packet to=${packet.nexthop_id} for=${packet.destination_id} in neighbor's slot[NODE]`);
            }
            return packet;
        }

        if (cell.neighbor_id === constants.BROADCAST_ID) {
            /* broadcast cell; select any unicast packet that matches the packet filter */
            for (const [id, neighbor] of this.neighbors) {
                if (neighbor.is_broadcast || neighbor.tx_cells_count > 0) {
                    /* either a broadcast neighbor or has cells on its own; ignore this neighbor */
                    continue;
                }
                const packet = this.queue_get_packet_for_nbr(id, cell);
                if (packet != null) {
                    log.log(log.DEBUG, this, "TSCH", `tx a packet to=${packet.nexthop_id} for=${packet.destination_id}, nbr=${id}[NODE]`);
                    return packet;
                }
            }
        }

        return null;
    }

    /* Decide the scheduled action for this node at this timeslot. Possible actions:
     * - Sleep
     * - Tx
     * - Rx
     */

    // This method defines the schedule for transmission and reception packets
    schedule(schedule_status) {

        if (this.timeslots_to_skip > 1) {
            this.timeslots_to_skip -= 1;
            return SCHEDULE_DECISION_SLEEP;
        }

        // If node has not joined TSCH
        if (!this.has_joined) {
            this.selected_cell = this.scanning_rx_cell;
            schedule_status[this.index].flags = constants.FLAG_RX;
            // Channel offset of the cell currently being scanned
            schedule_status[this.index].co = this.selected_cell.channel_offset;
            // Add the channel number using the tsch hop sequence specified in the IEEE convention
            schedule_status[this.index].ch = this.join_hopseq[this.selected_cell.channel_offset];
            this.stats_slots_rx_scanning += 1;
            return SCHEDULE_DECISION_SCAN;
        }

        // Set Best Cell values to null
        let best_cell = null;
        let backup_cell = null;
        let best_time_to_timeslot = Infinity;
        this.tx_packet = null;
        this.selected_cell = null;

        // Loop through all the slotframes in the node
        for (const s of this.slotframes) {
            
            // Calculate current time slot using current time
            // log.log(log.INFO, this, "Node", `s.size: ${s.size}`);
            const timeslot = time.timeline.asn % s.size;
            
            // Loop through all cells inside the slotframe
            for (const cell of s.cells) {
                
                // Calculate time to timeslot to be used for tx/rx from the current timeslot and timeslot of the cell
                const time_to_timeslot =
                      cell.timeslot >= timeslot ?
                      cell.timeslot - timeslot :
                      s.size + cell.timeslot - timeslot;

                // Update best time slot
                if (time_to_timeslot < best_time_to_timeslot) {
                    best_time_to_timeslot = time_to_timeslot;
                }

                // If no time left to the required timeslot
                if (time_to_timeslot === 0) {
                    if (cell.action) {
                        /* This cell requests us to do some action when it is selected; currently,
                        * the action is always done regardless of whether there are any other cells in this slot.
                         */
                        cell.action(this);
                    }
  
                    // Set the value of best cell as the currently selected cell if the best cell has not been set
                    if (!best_cell) {
                        best_cell = cell;
                        continue;
                    }

                    let new_best;
                    if ((cell.options & constants.CELL_OPTION_TX) === (best_cell.options & constants.CELL_OPTION_TX)) {
                        /* both are tx or both are rx */
                        new_best = sf.select_best_tsch_cell(this, best_cell, cell);
                    } else {
                        /* prioritize the tx cell */
                        new_best = (cell.options & constants.CELL_OPTION_TX) ? cell : best_cell;
                    }

                    /* maintain backup_cell */
                    /* Check if 'cell' can be used as backup */
                    // & is bitwise AND
                    if (new_best !== cell && (cell.options & constants.CELL_OPTION_RX)) {
                        if (!backup_cell) {
                            backup_cell = cell;
                        } else if (cell.slotframe.handle < backup_cell.slotframe.handle) {
                            backup_cell = cell;
                        }
                    }
                    
                    /* Check if 'best_cell' can be used as backup */
                    else if (new_best !== best_cell && (best_cell.options & constants.CELL_OPTION_RX)) {
                        if (!backup_cell) {
                            backup_cell = best_cell;
                        } else if (best_cell.slotframe.handle < backup_cell.slotframe.handle) {
                            backup_cell = best_cell;
                        }
                    }

                    /* maintain the best cell */
                    if (new_best) {
                        best_cell = new_best;
                    }
                }
            }
        }

        if (best_time_to_timeslot === Infinity) {
            /* no active cells scheduled; search again in the next slotframe */
            this.timeslots_to_skip = 0;
        } else {
            this.timeslots_to_skip = best_time_to_timeslot;
        }

        if (best_cell) {
            /* log.log(log.DEBUG, this, "TSCH", `got best cell timeslot=${best_cell.timeslot} options=${best_cell.options} sf=${best_cell.slotframe.handle}`); */
            this.tx_packet = this.get_packet_for_tx_cell(best_cell, backup_cell);
            this.selected_cell = best_cell;

            if (!this.tx_packet && backup_cell) {
                /* the best cell does not have packets; look at whether we should prioritize the backup cell */
                if (!(best_cell.options & constants.CELL_OPTION_RX)) {
                    this.selected_cell = backup_cell;
                    this.tx_packet = this.get_packet_for_tx_cell(this.selected_cell, null);
                } else if (backup_cell.slotframe.handle < best_cell.slotframe.handle) {
                    this.selected_cell = backup_cell;
                    this.tx_packet = this.get_packet_for_tx_cell(this.selected_cell, null);
                }
            }
        }

        // If the best cell and the backup cell did not end up being viable options, return decision to sleep
        if (!this.selected_cell) {
            return SCHEDULE_DECISION_SLEEP;
        }

        // If the code gets here, means a cell has been selected, be it best cell or back up cell, but a packet to be sent may or may not be determined yet
        // Set slotframe, timeslot and channel offset of the cell
        schedule_status[this.index].ts = this.selected_cell.timeslot;
        schedule_status[this.index].co = this.selected_cell.channel_offset;
        schedule_status[this.index].sf = this.selected_cell.slotframe.handle;

        if ((this.selected_cell.options & constants.CELL_OPTION_TX)
            && (this.selected_cell.options & constants.CELL_OPTION_SHARED)) {
            /* Decrement the backoff window for all neighbors able to transmit over
             * this Tx, Shared cell. */
            this.queue_update_all_backoff_windows(this.selected_cell);
        }


        if (this.tx_packet) {
            /* Tx and found a packet to send */
            /* log.log(log.DEBUG, this, "TSCH", `got tx cell, timeslot=${this.selected_cell.timeslot} sf=${schedule_status[this.index].sf}`); */
            schedule_status[this.index].flags = constants.FLAG_TX;
            if (this.tx_packet.packetbuf.hasOwnProperty("PACKETBUF_ATTR_TSCH_CHANNEL_OFFSET")
                && this.tx_packet.packetbuf.PACKETBUF_ATTR_TSCH_CHANNEL_OFFSET != 0xffffffff) {
                /* use the channel offset from the packet */
                schedule_status[this.index].co = this.tx_packet.packetbuf.PACKETBUF_ATTR_TSCH_CHANNEL_OFFSET;
                /* log.log(log.DEBUG, this, "TSCH", `using channel offset=${schedule_status[this.index].co} from packet`); */
            } else {
                /* log.log(log.DEBUG, this, "TSCH", `using channel offset=${schedule_status[this.index].co} from cell`); */
            }
            return SCHEDULE_DECISION_TX;
        }

        // If the execution reaches this point, the packet to transmit wasn't found
        if (!(this.selected_cell.options & constants.CELL_OPTION_RX)) {
            /* no packet to send, sleep */
            // This.index is the index in the network
            schedule_status[this.index].flags = constants.FLAG_SKIPPED_TX; /* assume it was Tx cell */
            schedule_status[this.index].co = this.selected_cell.channel_offset;
            return SCHEDULE_DECISION_SLEEP;
        }

        /* log.log(log.DEBUG, this, "TSCH",  `got rx cell (${this.selected_cell.timeslot}, ${this.selected_cell.channel_offset}) sf=${schedule_status[this.index].sf}`); */
        schedule_status[this.index].flags = constants.FLAG_RX;
        schedule_status[this.index].co = this.selected_cell.channel_offset;
        /* this will be changed later if an actual packet is received */
        this.stats_slots_rx_idle += 1;
        return SCHEDULE_DECISION_RX;
    }

    /* ------------------------------------------------------------- */

    /* This function takes a packet to transmit and dispatches it to all connected neighbors. */
    commit_tx(potential_rx_nodes, schedule_status, transmissions) {
        /* update the packet's status */
        this.tx_packet.num_transmissions += 1;
        this.tx_packet.rx_info = {};
        /* update this node's stats */
        this.stats_mac_tx += 1;
        if (this.tx_packet.is_ack_required) {
            this.stats_mac_tx_unicast += 1;
            this.stats_slots_tx_packet_rx_ack[this.tx_packet.length] += 1;
        } else {
            this.stats_slots_tx_packet[this.tx_packet.length] += 1;
        }
        /* update the schedule status for the web interface */
        schedule_status[this.index].flags |= constants.FLAG_PACKET_TX;
        schedule_status[this.index].from = this.id;
        schedule_status[this.index].to = this.tx_packet.nexthop_id;
        schedule_status[this.index].l = this.tx_packet.length;

        this.log(log.DEBUG, `tx length=${this.tx_packet.length} to=${this.tx_packet.nexthop_id} ack_required=${this.tx_packet.is_ack_required}[NODE]`);
        /* try to send to each potential neighbor; the neighbors will filter out packets by the nexthop specified in the packet */
        // Loop through all possible neighbor in the links map and send to all neighbours
        for (const [dst_id, _] of this.links) {
            const dst = this.network.get_node(dst_id);

            // Now dst stores the id of the destination node
            /* if the tx is unicast to the parent, update parent stats */
            if (this.tx_packet.is_ack_required
                && this.current_time_source
                && this.current_time_source.id === dst.id) {
                this.stats_mac_parent_tx_unicast += 1;
            }

            const dst_status = schedule_status[dst.index];
            if (!dst_status) {
                continue;
            }

            if (!(dst_status.flags & constants.FLAG_RX)) {
                continue;
            }

            if (dst.selected_cell == null) {
                /* The dst node is idle at this point */
                /* this.log(log.DEBUG, `  commit_tx ${dst.id}: dst not listening`); */
                continue;
            }

            if (dst.tx_packet != null) {
                /* The dst node is transmitting its own packet */
                /* this.log(log.DEBUG, `  commit_tx ${dst.id}: dst is transmitting`); */
                continue;
            }

            this.commit_tx_to(dst, potential_rx_nodes, schedule_status, transmissions);
        }
    }

    /* This function sends a packet to a specific neighbor.
     * First, it checks if the potential receiver node is listening.
     * Then it calculates the RSSI and rolls a dice to decide if the Rx was successful.
     */
    commit_tx_to(dst, potential_rx_nodes, schedule_status, transmissions) {
        const channel_tx = schedule_status[this.index].ch;
        const channel_rx = dst.get_channel(dst.selected_cell.channel_offset);
        const link_to = this.links.get(dst.id);
        const can_receive = link_to
              && (dst.selected_cell.options & constants.CELL_OPTION_RX)
              && channel_tx === channel_rx;
        if (can_receive) {
            /* successfully Tx'ed at the link layer? */
            const send_success = link_to.try_send(channel_tx);
            this.log(log.DEBUG, `  commit_tx_to ${dst.id}: reception_possible=${send_success}[NODE]`);
            /* copy the RSSI of this Tx attempt */
            this.tx_packet.rx_info[dst.id] = new pkt.RxInfo(link_to.last_rssi);
            /* add this dst to the nodes that have received some packets in this round */
            if (dst.rx_ok_packets[this.tx_packet.subslot].length === 0
                && dst.rx_failed_packets[this.tx_packet.subslot].length === 0) {
                potential_rx_nodes.push(dst);
                dst.is_any_packet_rx_in_subslot = false;
            }

            if (send_success) {
                dst.rx_ok_packets[this.tx_packet.subslot].push(this.tx_packet);
            } else {
                dst.rx_failed_packets[this.tx_packet.subslot].push(this.tx_packet);
                this.stats_mac_rx_error += 1;
            }
            transmissions.push({from: this.id, to: dst.id, ok: send_success});
        } else {
            /* this.log(log.DEBUG, `  commit_tx_to ${dst.id}: wrong channel tx=${schedule_status[this.index].co}/${channel_tx} rx=${dst.selected_cell.channel_offset}/${channel_rx}`); */
        }
    }

    /* This function implements packet collisions in case there are multiple Rx packets in a single (sub)slot */
    commit_rx(subslot, schedule_status) {

        if (this.config.EMULATE_COOJA && this.is_any_packet_rx_in_subslot) {
            /* a hack to better match the behavior in Contiki-NG: if any packet was detected on the air
             * in a previous subslot, all potential packets in the current subslot are ignored. */
            if (this.rx_ok_packets[subslot].length !== 0) {
                this.rx_ok_packets[subslot] = [];
            }
            if (this.rx_failed_packets[subslot].length !== 0) {
                this.rx_failed_packets[subslot] = [];
            }
            return;
        }

        if (this.rx_ok_packets[subslot].length === 0) {
            /* No packets to consider */
            if (this.rx_failed_packets[subslot].length !== 0) {
                this.is_any_packet_rx_in_subslot = true;
                this.rx_failed_packets[subslot] = []; /* reset the state */
            }
            return;
        }

        this.is_any_packet_rx_in_subslot = true;

        /* Only one packet? */
        if (this.rx_ok_packets[subslot].length === 1 && this.rx_failed_packets[subslot].length === 0) {
            const best_packet = this.rx_ok_packets[subslot][0];
            // Packet received at Link and then moves on to Network layer
            const success = this.rx_packet_link_layer(
                best_packet, this.selected_cell, schedule_status);
            if (success) {
                best_packet.rx_info[this.id].rx_success = true;
            } else {
                /* XXX: maybe only set if addressed to me? */
                schedule_status[this.index].flags |= constants.FLAG_PACKET_BADRX;
            }
            this.rx_ok_packets[subslot] = []; /* reset the state */
            return;
        }

        /* More than one packet. Run the full reception algorithm with the capture effect */
        let best_packet = this.rx_ok_packets[subslot][0];
        let interfering_signal_rssi = -Infinity;
        if (this.config.EMULATE_COOJA) {
            /* use simplified capture effect modeling to match cooja better */
            let second_best_packet = null;
            for (let i = 1; i < this.rx_ok_packets[subslot].length; ++i) {
                const packet = this.rx_ok_packets[subslot][i];
                if (packet.rx_info[this.id].rssi > best_packet.rx_info[this.id].rssi) {
                    second_best_packet = best_packet;
                    best_packet = packet;
                } else if (second_best_packet == null
                           || packet.rx_info[this.id].rssi > second_best_packet.rx_info[this.id].rssi) {
                    second_best_packet = packet;
                }
            }
            if (second_best_packet != null) {
                interfering_signal_rssi = second_best_packet.rx_info[this.id].rssi;
            }
        } else {
            /* use mathematically correct capture effect modeling */
            const best_packet_rssi = best_packet.rx_info[this.id].rssi;
            let sum_signals = dbm_to_mw(best_packet_rssi);
            for (let i = 1; i < this.rx_ok_packets[subslot].length; ++i) {
                const packet = this.rx_ok_packets[subslot][i];
                if (packet.rx_info[this.id].rssi > best_packet_rssi) {
                    best_packet = packet;
                }
                sum_signals += dbm_to_mw(packet.rx_info[this.id].rssi);
            }
            for (let i = 0; i < this.rx_failed_packets[subslot].length; ++i) {
                const packet = this.rx_failed_packets[subslot][i];
                sum_signals += dbm_to_mw(packet.rx_info[this.id].rssi);
            }
            sum_signals -= dbm_to_mw(best_packet_rssi);
            interfering_signal_rssi = mw_to_dbm(sum_signals);
        }

        /* implement the capture effect using the CO_CHANNEL_REJECTION_DB threshold */
        if (best_packet.rx_info[this.id].rssi + this.config.PHY_CO_CHANNEL_REJECTION_DB > interfering_signal_rssi) {
            /* yes! the best packet is received */
            this.log(log.DEBUG, `capture effect, best_rssi=${best_packet.rx_info[this.id].rssi} other_rssi=${interfering_signal_rssi}`);
            const success = this.rx_packet_link_layer(
                best_packet, this.selected_cell, schedule_status);
            if (success) {
                best_packet.rx_info[this.id].rx_success = true;
            } else {
                /* XXX: maybe only set if addressed to me? */
                schedule_status[this.index].flags |= constants.FLAG_PACKET_BADRX;
            }
        }
        /* update the stats: note a collision for each packet that had strong enough RSSI, but was not received because of interference */
        for (const packet of this.rx_ok_packets[subslot]) {
            if (!packet.rx_info[this.id].rx_success) {
                this.stats_mac_rx_collision += 1;
            }
        }
        /* reset the state */
        this.rx_failed_packets[subslot] = [];
        this.rx_ok_packets[subslot] = [];
    }

    /*
     * This function decides the ACK RSSI and status (success/failure).
     * A simple ACK model is assumed where the sender is always listening
     * on the right (Tx) channel and there is only a single ACK, no collisions.
     */
    commit_ack(schedule_status) {
        const packet = this.tx_packet;
        const to_id = packet.nexthop_id;
        let status_ok = false;
        if (packet.is_ack_required) {
            this.log(log.DEBUG, `commit ack, from=${to_id}`);
            schedule_status[this.index].flags |= constants.FLAG_ACK;
            /* succesfully received at the link layer? */
            const rx_info = packet.rx_info[to_id];
            if (rx_info !== undefined && rx_info.rx_success) {
                /* for broadcast packets, ACK should never be required */
                assert(to_id !== constants.BROADCAST_ID, "is_ack_required for broadcast?", null);
                const link_from = this.network.get_link(to_id, this.id);
                /* succesfully acked at the link layer? */
                const ack_success = link_from && link_from.try_send(schedule_status[this.index].ch);
                if (ack_success) {
                    schedule_status[this.index].flags |= constants.FLAG_ACK_OK;
                    this.stats_mac_acked += 1;
                    /* tx to parent? */
                    if (this.current_time_source && this.current_time_source.id === to_id) {
                        this.stats_mac_parent_acked += 1;
                    }
                } else {
                    this.stats_mac_ack_error += 1;
                }
                status_ok = ack_success;
            }
        } else {
            /* No ACK needed */
            status_ok = true;
        }

        let neighbor;
        if (packet.destination_id === constants.EB_ID) {
            neighbor = this.neighbors.get(constants.EB_ID);
        } else {
            neighbor = this.neighbors.get(to_id);
        }
        this.update_neighbor_after_tx(neighbor, status_ok);

        /* remove if either got the ACK, or if the Tx limit is reached */
        let do_remove = status_ok;
        const tx_limit = this.config.MAC_MAX_RETRIES + 1;
        if (!status_ok && packet.num_transmissions >= tx_limit) {
            /* will be dropped because the Tx limit is reached */
            do_remove = true;
            if (packet.packet_protocol === constants.PROTO_APP) {
                let nexthop = this.network.get_node(packet.nexthop_id);
                assert(nexthop, `unknown nexthop node ${packet.nexthop_id}`);
                const effective_source_id = (packet.query_status == constants.PACKET_IS_RESPONSE ? packet.destination_id : packet.source.id);
                const seqnum = effective_source_id + "#" + packet.seqnum;
                const search_set = packet.destination_id === packet.nexthop_id ?
                    nexthop.stats_app_packets_rxed :
                    nexthop.stats_app_packets_seen;
                if (search_set.has(seqnum)) {
                    /* the packet will be dropped by the intermediate node, but the nexthop already has received it */
                    log.log(log.DEBUG, this, "App", `giving up on app packet transmissions seqnum=${packet.seqnum} for=${packet.destination_id} to=${packet.nexthop_id}: tx_limit=${tx_limit} reached[NODE]`);
                } else {
                    /* the packet is truly lost */
                    log.log(log.INFO, this, "App", `dropping app packet seqnum=${packet.seqnum} for=${packet.destination_id} to=${packet.nexthop_id}: tx_limit=${tx_limit} reached[NODE]`);
                    packet.source.stats_app_num_tx_limit_drops += 1;
                }
            } else {
                this.log(log.DEBUG, `dropping packet seqnum=${packet.seqnum} for=${packet.destination_id} to=${packet.nexthop_id}: tx_limit=${tx_limit} reached[NODE]`);
            }
        }

        if (do_remove) {
            if (packet.is_ack_required) {
                this.log(log.INFO, `tx done from=${this.id} source=${packet.source.id} to=${packet.nexthop_id} destination=${packet.destination_id} numtx=${packet.num_transmissions} seqnum=${packet.seqnum} packet buffer: timeslot: ${packet.packetbuf.PACKETBUF_ATTR_TSCH_TIMESLOT} channel offset: ${packet.packetbuf.PACKETBUF_ATTR_TSCH_CHANNEL_OFFSET} acked=${status_ok}, remove packet[NODE]`);
             }
            /* update the neighbor, as the Tx of this packet is done */
            this.packet_sent(packet, neighbor, status_ok, this.selected_cell);
            /* remove the first packet from the queue */
            neighbor.pop_packet();
        } else {
            if (packet.is_ack_required) {
                this.log(log.INFO, `tx done from=${this.id} source=${packet.source.id} to=${packet.nexthop_id} destination=${packet.destination_id} numtx=${packet.num_transmissions} seqnum=${packet.seqnum} packet buffer: timeslot: ${packet.packetbuf.PACKETBUF_ATTR_TSCH_TIMESLOT} channel offset: ${packet.packetbuf.PACKETBUF_ATTR_TSCH_CHANNEL_OFFSET} acked=${status_ok}[NODE]`);
            }
        }

        /* reset the local state */
        this.tx_packet = null;
    }

    /* Packet sent callback */
    packet_sent(packet, neighbor, status_ok, cell) {
        if (neighbor) {
            neighbor.on_tx(packet.num_transmissions, status_ok, packet.is_ack_required, cell);
            this.routing.on_tx(neighbor, packet, status_ok, packet.is_ack_required, cell);
        }
        scheduler.on_tx(this, packet, status_ok);
        if (packet.sent_callback) {
            packet.sent_callback(packet, status_ok);
        }
    }

    /* Update neighbor backoff state after a transmission */
    update_neighbor_after_tx(neighbor, ack_success) {
        const is_unicast = !neighbor.is_broadcast;
        const is_shared_cell = this.selected_cell.options & constants.CELL_OPTION_SHARED;
        /* this.log(log.DEBUG, `update neighbor ${neighbor.id} ack_success=${ack_success} is_unicast=${is_unicast} options=${this.selected_cell.options}`); */
        if (ack_success) {
            /* Update CSMA state in the unicast case */
            if (is_unicast) {
                if (is_shared_cell || !neighbor.has_packets()) {
                    /* If this is a shared cell, reset backoff on success.
                     * Otherwise, do so only is the queue is empty */
                    this.queue_backoff_reset(neighbor);
                }

                if (neighbor.is_time_source) {
                    /* Got ACK from time source, reset keepalive timer */
                    this.log(log.DEBUG, `time resynchronized: got an ACK from the time source`);
                    this.schedule_desync(this.config.MAC_KEEPALIVE_TIMEOUT_S, this.config.MAC_DESYNC_THRESHOLD_S);
                }
            }
        } else {
            /* Update CSMA state in the unicast case */
            if (is_unicast) {
                /* Failures on dedicated (== non-shared) links leave
                 * the backoff window and the backoff exponent unchanged */
                if (is_shared_cell) {
                    /* Shared link: increment backoff exponent, pick a new window */
                    this.queue_backoff_inc(neighbor);
                }
            }
        }
    }

    /* ------------------------------------------------------------- */


    aggregate_stats() {
        
        log.log(log.INFO, this, "Node", `aggregate stats method called for Node ${this.id} [NODE]`);
       
        // Call the list routes method for this node
        this.list_routes();

        const charge_uc = energy_model.estimate_charge_uc(this);
        const pretty_charge_uc = parseFloat(charge_uc.total.toFixed(1));
        const pretty_charge_joined_uc = parseFloat((charge_uc.total - charge_uc.scanning).toFixed(1));

        const duty_cycle = energy_model.estimate_duty_cycle(this);
        const pretty_radio_duty_cycle = parseFloat((100.0 * duty_cycle.total).toFixed(3));
        const pretty_radio_duty_cycle_joined = parseFloat((100.0 * (duty_cycle.total - duty_cycle.scanning)).toFixed(3));
        const app_num_lost = this.stats_app_num_queue_drops
              + this.stats_app_num_tx_limit_drops
              + this.stats_app_num_routing_drops
              + this.stats_app_num_scheduling_drops
              + this.stats_app_num_other_drops;
        // Return stats as a structure
        return {
            app_num_tx: this.stats_app_num_tx,
            app_num_replied: this.stats_app_num_replied,
            app_num_endpoint_rx: this.stats_app_num_endpoint_rx,
            app_num_lost: app_num_lost,
            app_reliability: 100.0 * (1.0 - div_safe(app_num_lost, this.stats_app_num_endpoint_rx + app_num_lost)),
            /* alternatively, could use stats_app_num_tx here, like this:
               app_reliability: 100.0 * div_safe(this.stats_app_num_tx - app_num_lost, this.stats_app_num_tx), */
            app_num_queue_drops: this.stats_app_num_queue_drops,
            app_num_tx_limit_drops: this.stats_app_num_tx_limit_drops,
            app_num_routing_drops: this.stats_app_num_routing_drops,
            app_num_scheduling_drops: this.stats_app_num_scheduling_drops,
            app_num_other_drops: this.stats_app_num_other_drops,

            tsch_eb_tx: this.stats_tsch_eb_tx,
            tsch_eb_rx: this.stats_tsch_eb_rx,
            tsch_keepalive_tx: this.stats_tsch_keepalive_tx,
            tsch_keepalive_rx: this.stats_tsch_keepalive_rx,

            mac_tx: this.stats_mac_tx,
            mac_tx_unicast: this.stats_mac_tx_unicast,
            mac_acked: this.stats_mac_acked,
            mac_rx: this.stats_mac_rx,
            mac_rx_error: this.stats_mac_rx_error,
            mac_rx_collision: this.stats_mac_rx_collision,
            mac_ack_error: this.stats_mac_ack_error,

            mac_parent_tx_unicast: this.stats_mac_parent_tx_unicast,
            mac_parent_acked: this.stats_mac_parent_acked,
            mac_parent_rx: this.stats_mac_parent_rx,

            slots_rx_idle: this.stats_slots_rx_idle,
            slots_rx_scanning: this.stats_slots_rx_scanning,
            slots_rx_packet: Object.values(this.stats_slots_rx_packet).sum(),
            slots_rx_packet_tx_ack: Object.values(this.stats_slots_rx_packet_tx_ack).sum(),
            slots_tx_packet: Object.values(this.stats_slots_tx_packet).sum(),
            slots_tx_packet_rx_ack: Object.values(this.stats_slots_tx_packet_rx_ack).sum(),

            tsch_join_time_sec: this.stats_tsch_join_time_sec,
            tsch_num_parent_changes: this.stats_tsch_num_parent_changes,

            routing_num_tx: this.stats_routing_num_tx,
            routing_num_rx: this.stats_routing_num_rx,

            app_latency_min_s: Math.min(...this.stats_app_latencies),
            app_latency_avg_s: this.stats_app_latencies.avg(),
            app_latency_max_s: Math.max(...this.stats_app_latencies),
            app_latencies: this.stats_app_latencies,

            radio_duty_cycle: pretty_radio_duty_cycle,
            radio_duty_cycle_joined: pretty_radio_duty_cycle_joined,

            charge_uc: pretty_charge_uc,
            charge_joined_uc: pretty_charge_joined_uc,
            avg_current_uA: parseFloat(div_safe(pretty_charge_uc, time.timeline.seconds).toFixed(1)),
            avg_current_joined_uA: parseFloat(div_safe(pretty_charge_joined_uc, time.timeline.seconds).toFixed(1)),

            ...this.routing.stats_get()
        };
    }
    // Method to display the routes in the routing table [preferrably call at the end]
    list_routes() {
        log.log(log.INFO, this, "Node", `Final routes for Node ${this.id} [NODE]`);
        log.log(log.INFO, this, "Node", `Total Routes ${this.routes.routes.size} [NODE]`);
        for (const [_,route] of this.routes.routes) {
            log.log(log.INFO, this, "Node", `route destination: ${route.prefix} and next hop id: ${route.nexthop_id}`);
        }
    }
}

// This process is executed periodically for every node
export function periodic_process()
{
    log.log(log.INFO, null, "TSCH", `Periodic process called for [Node]`);
    // loop through all nodes in the simulator
    for (const [_, node] of simulator.get_nodes()) {
        /* process routing */
        node.routing.on_periodic_timer();

        const obj = {
            idle_listen: node.stats_slots_rx_idle,
            channel_scan: node.stats_slots_rx_scanning,
            rx_data: Object.values(node.stats_slots_rx_packet).sum(),
            rx_data_tx_ack: Object.values(node.stats_slots_rx_packet_tx_ack).sum(),
            tx_data: Object.values(node.stats_slots_tx_packet).sum(),
            tx_data_rx_ack: Object.values(node.stats_slots_tx_packet_rx_ack).sum(),
        };

        log.log(log.INFO, node, "TSCH", `stats: ` + JSON.stringify(obj) + `[NODE]`);
    }
}
