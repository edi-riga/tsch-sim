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
 *         A TSCH network.
 * \author
 *         Atis Elsts <atis.elsts@edi.lv>
 */

import config from "./config.mjs";
import * as utils from './utils.mjs';
import * as networknode from './node.mjs';
import * as log from './log.mjs';
import * as time from './time.mjs';

/* ------------------------------------- */

/* A network */
export class Network {
    constructor() {
        this.nodes = new Map();
        this.links = new Map();
        this.mobility_model = null;
        this.protocol_handlers = new Map();

        this.reset_stats();
    }

    reset_stats() {
        /* statistics: end-to-end */
        this.stats_app_num_tx = 0;
        this.stats_app_num_replied = 0;
        this.stats_app_num_endpoint_rx = 0;
        this.stats_app_num_lost = 0;
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
        this.stats_mac_parent_tx_unicast = 0;
        this.stats_mac_parent_acked = 0;
        this.stats_mac_parent_rx = 0;
        /* statistics: slot usage */
        this.stats_slots_rx_idle = 0;
        this.stats_slots_rx_packet = 0;
        this.stats_slots_rx_packet_tx_ack = 0;
        this.stats_slots_tx_packet = 0;
        this.stats_slots_tx_packet_rx_ack = 0;
        /* statistics: joining */
        this.stats_tsch_join_time_sec = 0;
        this.stats_tsch_num_parent_changes = 0;
        /* statistics: routing */
        this.stats_routing_num_tx = 0;
        this.stats_routing_num_rx = 0;
        this.stats_routing_join_time_sec = 0;
        this.stats_routing_num_parent_changes = 0;
    }

    add_node(id, type_config) {
        utils.assert(!this.nodes.has(id), `node with ID ${id} already present[NETWORK]`);
        const index = this.nodes.size;
        let n = new networknode.Node(id, index, type_config, this);
        this.nodes.set(id, n);
        return n;
    }
    
    get_node(id) {
        const result = this.nodes.get(id);
        utils.assert(result !== undefined, `unknown node ID ${id}[NETWORK]`);
        return result;
    }
    
    // Same as get node
    find_node(id) {
        return this.nodes.get(id);
    }

    add_link(lnk) {
        const key = lnk.from.id + "#" + lnk.to.id;
        utils.assert(!this.links.has(key), `link from ${lnk.from.id} to ${lnk.to.id} already present[NETWORK]`);
        this.links.set(key, lnk);
        if (lnk.is_active) {
            lnk.from.links.set(lnk.to.id, lnk);
        } else {
            lnk.from.potential_links.set(lnk.to.id, lnk);
        }
        return lnk;
    }
    get_link(from_id, to_id) {
        const key = from_id + "#" + to_id;
        const result = this.links.get(key);
        utils.assert(result !== undefined, `unknown link from ${from_id} to ${to_id}[NETWORK]`);
        return result;
    }
    find_link(from_id, to_id) {
        const key = from_id + "#" + to_id;
        return this.links.get(key);
    }
    update_node_links(node) {
        const activated_links = [];
        for (const [_, link] of node.potential_links) {
            if (link.update) {
                link.update();
                if (link.is_active) {
                    activated_links.push(link);
                }
            }
        }
        for (let alink of activated_links) {
            alink.from.potential_links.delete(alink.to.id);
            alink.from.links.set(alink.to.id, alink);
            /* also update the link in the other direction */
            const reverse_link = alink.to.potential_links.get(alink.from.id);
            if (reverse_link) {
                reverse_link.from.potential_links.delete(reverse_link.to.id);
                reverse_link.from.links.set(reverse_link.to.id, reverse_link);
            }
        }
    }


    set_protocol_handler(protocol, msg_type, callback) {
        const key = (protocol << 8) + msg_type;
        this.protocol_handlers.set(key, callback);
    }

    get_protocol_handler(protocol, msg_type) {
        const key = (protocol << 8) + msg_type;
        return this.protocol_handlers.get(key);
    }

    get_time_source_tree() {
        const result = {};
        for (let [id, node] of this.nodes) {
            if (node.current_time_source != null) {
                result[id] = node.current_time_source.id;
            } else {
                result[id] = null;
            }
        }
        return result;
    }

    aggregate_stats() {
        log.log(log.INFO, null, "Main", `aggregate stats method called [NETWORK]`);
        let stats = {};
        let charge_uc = 0;
        let charge_joined_uc = 0;

        for (let [id, node] of this.nodes) {
            const node_stats = node.aggregate_stats();

            stats["" + id] = node_stats;

            /* statistics: end-to-end */
            this.stats_app_num_tx += node_stats.app_num_tx;
            this.stats_app_num_replied += node_stats.app_num_replied;
            this.stats_app_num_endpoint_rx += node_stats.app_num_endpoint_rx;
            this.stats_app_num_lost += node_stats.app_num_lost;
            this.stats_app_num_queue_drops += node_stats.app_num_queue_drops;
            this.stats_app_num_tx_limit_drops += node_stats.app_num_tx_limit_drops;
            this.stats_app_num_routing_drops += node_stats.app_num_routing_drops;
            this.stats_app_num_scheduling_drops += node_stats.app_num_scheduling_drops;
            this.stats_app_num_other_drops += node_stats.app_num_other_drops;
            this.stats_app_latencies = this.stats_app_latencies.concat(node_stats.app_latencies);
            
            /* statistics: TSCH protocol */
            this.stats_tsch_eb_tx += node_stats.tsch_eb_tx;
            this.stats_tsch_eb_rx += node_stats.tsch_eb_rx;
            this.stats_tsch_keepalive_tx += node_stats.tsch_keepalive_tx;
            this.stats_tsch_keepalive_rx += node_stats.tsch_keepalive_rx;
            
            /* statistics: link layer */
            this.stats_mac_tx += node_stats.mac_tx;
            this.stats_mac_tx_unicast += node_stats.mac_tx_unicast;
            this.stats_mac_acked += node_stats.mac_acked;
            this.stats_mac_rx += node_stats.mac_rx;
            this.stats_mac_rx_error += node_stats.mac_rx_error;
            this.stats_mac_rx_collision += node_stats.mac_rx_collision;
            this.stats_mac_ack_error += node_stats.mac_ack_error;
            
            /* statistics: link layer, for the parent neighbor */
            this.stats_mac_parent_tx_unicast += node_stats.mac_parent_tx_unicast;
            this.stats_mac_parent_acked += node_stats.mac_parent_acked;
            this.stats_mac_parent_rx += node_stats.mac_parent_rx;
            
            /* statistics: slot usage */
            this.stats_slots_rx_idle += node_stats.slots_rx_idle;
            this.stats_slots_rx_scanning += node_stats.slots_rx_scanning;
            this.stats_slots_rx_packet += node_stats.slots_rx_packet;
            this.stats_slots_rx_packet_tx_ack += node_stats.slots_rx_packet_tx_ack;
            this.stats_slots_tx_packet += node_stats.slots_tx_packet;
            this.stats_slots_tx_packet_rx_ack += node_stats.slots_tx_packet_rx_ack;
            
            /* statistics: joining */
            if (this.stats_tsch_join_time_sec != null) {
                if (node_stats.tsch_join_time_sec == null) {
                    this.stats_tsch_join_time_sec = null;
                } else {
                    this.stats_tsch_join_time_sec += node_stats.tsch_join_time_sec;
                }
            }
            this.stats_tsch_num_parent_changes += node_stats.tsch_num_parent_changes;
            /* statistics: routing */
            this.stats_routing_num_tx += node_stats.routing_num_tx;
            this.stats_routing_num_rx += node_stats.routing_num_rx;
            if (this.stats_routing_join_time_sec != null) {
                if (node_stats.routing_join_time_sec == null) {
                    this.stats_routing_join_time_sec = null;
                } else {
                    this.stats_routing_join_time_sec += node_stats.routing_join_time_sec;
                }
            }
            this.stats_routing_num_parent_changes = node_stats.routing_num_parent_changes;

            charge_uc += parseFloat(node_stats.charge_uc);
            charge_joined_uc += parseFloat(node_stats.charge_joined_uc);

        }

        const total_app_packets = this.stats_app_num_endpoint_rx + this.stats_app_num_lost;
        const pdr = total_app_packets ? 100.0 * (1.0 - utils.div_safe(this.stats_app_num_lost, total_app_packets)) : 0.0;
        const ll_par = 100.0 * utils.div_safe(this.stats_mac_parent_acked, this.stats_mac_parent_tx_unicast);

        stats["global-stats"] = {
            "app-packets-sent": [
                {
                    "total": this.stats_app_num_tx,
                    "name": "Number of application packets sent"
                }
            ],
            "app-packets-received": [
                {
                    "total": this.stats_app_num_endpoint_rx,
                    "name": "Number of application packets received"
                }
            ],
            "app-packets-lost": [
                {
                    "total": this.stats_app_num_lost,
                    "name": "Number of application packets lost"
                }
            ],
            "app-packets-replied": [
                {
                    "total": this.stats_app_num_replied,
                    "name": "Number of application query requests replied"
                }
            ],
            "current-consumed": [
                {
                    "name": "Current consumed",
                    "unit": "mA",
                    "mean":  parseFloat((utils.div_safe(charge_uc, time.timeline.seconds) / 1000).toFixed(1)),
                }
            ],
            "current-consumed-when-joined": [
                {
                    "name": "Current consumed",
                    "unit": "mA",
                    "mean":  parseFloat((utils.div_safe(charge_joined_uc, time.timeline.seconds) / 1000).toFixed(1)),
                }
            ],
            "e2e-delivery": [
                {
                    "value": pdr,
                    "name": "E2E delivery ratio",
                    "unit": "%"
                },
                {
                    "value": 100 - pdr,
                    "name": "E2E loss ratio",
                    "unit": "%"
                }
            ],
            "e2e-latency": [
                {
                    "name": "E2E latency",
                    "min": this.stats_app_latencies.min(),
                    "max": this.stats_app_latencies.max(),
                    "unit": "s",
                    "mean": this.stats_app_latencies.avg()
                }
            ]
        };

        log.log(log.INFO, null, "Main", `packet stats: PDR=${pdr.toFixed(2)}% generated=${this.stats_app_num_tx} received=${this.stats_app_num_endpoint_rx} lost=${this.stats_app_num_lost} (tx_limit/queue/routing/scheduling/other=${this.stats_app_num_tx_limit_drops}/${this.stats_app_num_queue_drops}/${this.stats_app_num_routing_drops}/${this.stats_app_num_scheduling_drops}/${this.stats_app_num_other_drops})[NETWORK]`);
        log.log(log.INFO, null, "Main", `link stats: PAR=${ll_par.toFixed(2)}% tx=${this.stats_mac_parent_tx_unicast} acked=${this.stats_mac_parent_acked}[NETWORK]`);

        /* stats can come from multiple runs, they are merged at the end; use "0" as the run ID for now */
        stats = {"0" : stats};

        return stats;
    }

    step() {
        /* log.log(log.DEBUG, null, "TSCH", `ASN=${time.timeline.asn}`); */
        if (this.mobility_model) {
            this.mobility_model.update_positions(this);
        }

        /* for the web interface */
        const schedule_status = [];
        const transmissions = [];

        /* schedule transmissions */
        // Add node to these arrays for each step based on the decision returned from schedule method in node
        const tx_nodes = [];
        const rx_nodes = [];

        // Loop through all nodes in the network
        for (const [_, node] of this.nodes) {
            //log.log(log.INFO, node, "Node", `This is the node ${node.id}`);
            schedule_status.push({});

            //log.log(log.INFO, node, "Node", `Schedule Status: timeslot=${schedule_status[node.index].ts}, Channel offset=${schedule_status[node.index].co} flags=${schedule_status[node.index].flags} slotframe =${schedule_status[node.index].sf} channel=${schedule_status[node.index].ch}`)

            // While looping through every node, it get decision to perform tx, rx or sleep for that particular node
            const ret = node.schedule(schedule_status);

            //log.log(log.INFO, node, "Node", `Schedule Status: timeslot=${schedule_status[node.index].ts}, Channel offset=${schedule_status[node.index].co} flags=${schedule_status[node.index].flags} slotframe =${schedule_status[node.index].sf} channel=${schedule_status[node.index].ch}`)
            // The schedule status gets updated when reaching here
            // If decision to transmit is returned add that to the list of tx_nodes
            if (ret === networknode.SCHEDULE_DECISION_TX) {
                tx_nodes.push(node);
            }

            if (schedule_status[node.index].co !== undefined) {
                /* set the physical channel from the channel offset */
                schedule_status[node.index].ch = node.get_channel(schedule_status[node.index].co);
            }
            //log.log(log.INFO, node, "Node", `Schedule Status: timeslot=${schedule_status[node.index].ts}, Channel offset=${schedule_status[node.index].co} flags=${schedule_status[node.index].flags} slotframe =${schedule_status[node.index].sf} channel=${schedule_status[node.index].ch}`)

        }
        
        // commit transmissions from each node that is ready for transmission
        for (const node of tx_nodes) {
            node.commit_tx(rx_nodes, schedule_status, transmissions);
        }

        /* commit receptions */
        for (const node of rx_nodes) {
            for (let i = 0; i < config.MAC_MAX_SUBSLOTS; ++i) {
                node.commit_rx(i, schedule_status);
            }
        }

        /* commit ACKs for all tx_nodes*/
        for (const node of tx_nodes) {
            node.commit_ack(schedule_status);
        }

        /* return true if there was some activity in this slot */
        const was_active_slot = tx_nodes.length > 0;
        //log.log(log.INFO, null, "Main", `step[NETWORK] called was_active_slot: ${was_active_slot}; transmissions: ${transmissions}`);
        return {was_active_slot, schedule_status, transmissions};
    }
}
