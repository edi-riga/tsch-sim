/*
 * Copyright (c) 2020, Institute of Electronics and Computer Science (EDI)
 * Copyright (c) 2017, RISE SICS.
 * Copyright (c) 2017, Inria.
 * Copyright (c) 2014-2015, Yanzi Networks AB.
 * Copyright (c) 2012-2014, Thingsquare, http://www.thingsquare.com/.
 * Copyright (c) 2009-2010, Swedish Institute of Computer Science.
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
 *         RPL routing protocol implementation.
 *         Based on the RPL-Lite implementation in Contiki-NG.
 *         Unlike RPL-Lite, uses storing mode and the OF0 objective function.
 * \author
 *         Atis Elsts <atis.elsts@edi.lv>
 */

import constants from './constants.mjs';
import config from './config.mjs';
import * as log from './log.mjs';
import * as time from './time.mjs';
import * as pkt from './packet.mjs';
import * as neighbor from './neighbor.mjs';
import { rng } from './random.mjs';
import { assert, round_to_ms } from './utils.mjs';

/********** Constants **********/

/* Special value indicating infinite rank. */
const RPL_INFINITE_RANK           = 0xFFFF;

const RPL_CODE_DIS                = 0x00; /* DAG Information Solicitation */
const RPL_CODE_DIO                = 0x01; /* DAG Information Option */
const RPL_CODE_DAO                = 0x02; /* Destination Advertisement Option */
const RPL_CODE_DAO_ACK            = 0x03; /* DAO acknowledgment */

const RPL_DAO_K_FLAG              = 0x80; /* DAO-ACK requested */
const RPL_DAO_D_FLAG              = 0x40; /* DODAG ID present */

const RPL_DAO_ACK_UNCONDITIONAL_ACCEPT = 0;
const RPL_DAO_ACK_ACCEPT               = 1;   /* 1 - 127 is OK but not good */
const RPL_DAO_ACK_UNABLE_TO_ACCEPT     = 128; /* >127 is fail */
const RPL_DAO_ACK_UNABLE_TO_ADD_ROUTE_AT_ROOT = 255; /* root can not accept */
const RPL_DAO_ACK_TIMEOUT              = -1;

const RPL_HDR_OPT_DOWN = 0x80;
const RPL_HDR_OPT_RANK_ERR = 0x40;
const RPL_HDR_OPT_FWD_ERR = 0x20;

const PKT_LEN_DIS = 8;
const PKT_LEN_DIO = 76;
const PKT_LEN_DAO = 20;
const PKT_LEN_DAO_ACK = 2;

const RPL_ZERO_LIFETIME = 0;

/* Constants from RFC6552. We use the default values */
const OF0_RANK_STRETCH = 0; /* Must be in the range [0;5] */
const OF0_RANK_FACTOR = 1; /* Must be in the range [1;4] */

/* Constants defined in RFC 8180 */
const OF0_MIN_STEP_OF_RANK = 1;
const OF0_MAX_STEP_OF_RANK = 9;

/* From the 6tisch simulator: if we have a "good" link to the parent,
 * stay with the parent even if the rank of the parent is worse than
 * the best neighbor by more than PARENT_SWITCH_RANK_THRESHOLD.
 * rank_increase is computed as per Section 5.1.1. of RFC 8180.
*/
const OF0_ETX_GOOD_LINK = 2;
function OF0_PARENT_SWITCH_RANK_INCREASE_THRESHOLD() {
    return ((3 * OF0_ETX_GOOD_LINK) - 2) * config.RPL_MIN_HOPRANKINC;
}

const MRHOF_MAX_LINK_METRIC = 4 * neighbor.ETX_DIVISOR;   /* Eq to 512 in Contiki-NG */
const MRHOF_MAX_PATH_COST   = 256 * neighbor.ETX_DIVISOR; /* Eq to 32768 in Contiki-NG */
const MRHOF_RANK_THRESHOLD  = 1.5 * neighbor.ETX_DIVISOR; /* Eq to 192 in Contiki-NG */
/* Additional, custom hysteresis based on time. If a neighbor was consistently
 * better than our preferred parent for at least TIME_THRESHOLD, switch to
 * this neighbor regardless of RANK_THRESHOLD. */
const MRHOF_TIME_THRESHOLD_SEC = 10 * 60;

const DAG_UNUSED = 0;
const DAG_INITIALIZED = 1;
const DAG_JOINED = 2;
const DAG_REACHABLE = 3;
const DAG_POISONING = 4;

const RPL_LOLLIPOP_MAX_VALUE        = 255;
const RPL_LOLLIPOP_CIRCULAR_REGION  = 127;
const RPL_LOLLIPOP_SEQUENCE_WINDOWS = 16;
const RPL_LOLLIPOP_INIT             = (RPL_LOLLIPOP_MAX_VALUE - RPL_LOLLIPOP_SEQUENCE_WINDOWS + 1);

function RPL_LOLLIPOP_INCREMENT(counter)
{
    if (counter > RPL_LOLLIPOP_CIRCULAR_REGION) {
        return (counter + 1) & RPL_LOLLIPOP_MAX_VALUE;
    }
    return (counter + 1) & RPL_LOLLIPOP_CIRCULAR_REGION;
}

function rpl_lollipop_greater_than(a, b)
{
    /* Check if we are comparing an initial value with an old value */
    if (a > RPL_LOLLIPOP_CIRCULAR_REGION && b <= RPL_LOLLIPOP_CIRCULAR_REGION) {
        return (RPL_LOLLIPOP_MAX_VALUE + 1 + b - a) > RPL_LOLLIPOP_SEQUENCE_WINDOWS;
    }
    /* Otherwise check if a > b and comparable => ok, or
       if they have wrapped and are still comparable */
    return (a > b && (a - b) < RPL_LOLLIPOP_SEQUENCE_WINDOWS) ||
           (a < b && (b - a) > (RPL_LOLLIPOP_CIRCULAR_REGION + 1 -
                                RPL_LOLLIPOP_SEQUENCE_WINDOWS));
}

function ROOT_RANK()
{
    return config.RPL_MIN_HOPRANKINC;
}

/*---------------------------------------------------------------------------*/

/* Module logging */
function mlog(severity, node, msg) {
    log.log(severity, node, "RPL", msg);
}

/*---------------------------------------------------------------------------*/

/* Initialize the RPL protocol configuration */
export function initialize(network) {
    const default_config = {
        RPL_OBJECTIVE_FUNCTION: "MRHOF",
        /* If enabled, DAO-ACK are sent and expected */
        RPL_WITH_DAO_ACK: true,
        /* If enabled, probing packets are sent periodically to keep neighbor link estimates up to date */
        RPL_WITH_PROBING: true,
        /* The DIO interval (n) represents 2^n ms */
        RPL_DIO_INTERVAL_MIN: 12,
        /* Maximum amount of DIO timer doublings */
        RPL_DIO_INTERVAL_DOUBLINGS: 8,
        /* DIO redundancy. To learn more about this, see RFC 6206. */
        RPL_DIO_REDUNDANCY: 0,
        /* Default route lifetime, minutes */
        RPL_DEFAULT_LIFETIME_MIN: 30,
        /* Maximum lifetime of a DAG, minutes */
        RPL_DAG_LIFETIME_MIN: 8 * 60,
        /* RPL probing interval */
        RPL_PROBING_INTERVAL_SEC: 90,
        /* RPL poisoning duration before leaving the DAG  */
        RPL_DELAY_BEFORE_LEAVING_SEC: 5 * 60,
        /* Interval of DIS transmission  */
        RPL_DIS_INTERVAL_SEC: 30,
        /* DAO transmissions are always delayed by RPL_DAO_DELAY +/- RPL_DAO_DELAY/2 */
        RPL_DAO_DELAY_SEC: 4,
        /* DAO packet retransmissions */
        RPL_DAO_MAX_RETRANSMISSIONS: 5,
        /* How long to wait for DAO ACK */
        RPL_DAO_RETRANSMISSION_TIMEOUT_SEC: 5,
        /* RFC 6550 defines the default MIN_HOPRANKINC as 256 (max: 8 times this value, threshold: 4 times) */
        RPL_MIN_HOPRANKINC: 256,
        /* If enabled, packets are dropped when a forwarding loop is detected */
        RPL_LOOP_ERROR_DROP: false
    };

    /* derived values */
    default_config.RPL_MAX_RANKINC = 8 * default_config.RPL_MIN_HOPRANKINC;
    default_config.RPL_SIGNIFICANT_CHANGE_THRESHOLD = 4 * default_config.RPL_MIN_HOPRANKINC;

    for (const key in default_config) {
        /* set the ones that have not been set from the config file */
        if (!config.hasOwnProperty(key)) {
            config[key] = default_config[key];
        }
    }

    network.set_protocol_handler(constants.PROTO_ICMP6, RPL_CODE_DIO,
                                 function(node, p) { node.routing.dio_input(p); });
    network.set_protocol_handler(constants.PROTO_ICMP6, RPL_CODE_DAO,
                                 function(node, p) { node.routing.dao_input(p); });
    network.set_protocol_handler(constants.PROTO_ICMP6, RPL_CODE_DAO_ACK,
                                 function(node, p) { node.routing.dao_ack_input(p); });
    network.set_protocol_handler(constants.PROTO_ICMP6, RPL_CODE_DIS,
                                 function(node, p) { node.routing.dis_input(p); });
}

/*---------------------------------------------------------------------------*/

class RPLNeighbor {
    constructor(neighbor) {
        this.neighbor = neighbor;
        this.rank = RPL_INFINITE_RANK;
        this.dtsn = 0;
        this.better_parent_since = null;
    }

    link_metric() {
        return this.neighbor.link_metric();
    }
}

/*---------------------------------------------------------------------------*/

/*
 * Routing Protocol for Lossy and Low Power Networks (RPL).
 */
export class RPL
{
    constructor(node) {
        this.node = node;
        this.state = DAG_UNUSED;
        this.version = RPL_LOLLIPOP_INIT;
        this.dtsn_out = RPL_LOLLIPOP_INIT;
        this.dag_id = null;
        this.preferred_parent = null;
        this.rpl_neighbors = new Map();
        /* The lowest rank seen in the current version */
        this.lowest_rank = null;
        /* The current rank */
        this.rank = null;
        /* The last rank advertised in a multicast-DIO */
        this.last_advertised_rank = null;
        this.lifetime = null;
        this.dio_intcurrent = 0; /* Current DIO interval */
        this.dio_send = false; /* internal trickle timer state: do we need to send a DIO at the next wakeup? */
        this.dio_counter = 0; /* internal trickle timer state: redundancy counter */
        this.dao_last_seqno = 0; /* the node's last sent DAO seqno */
        this.dao_last_acked_seqno = 0; /* the last seqno we got an ACK for */
        this.dao_transmissions = 0; /* the number of transmissions for the current DAO */
        this.dio_next_delay = 0;
        this.unicast_dio_target = null;
        this.urgent_probing_target = null;
        this.unprocessed_parent_switch = false;
        this.in_state_update = false;

        /* statistics: packets */
        this.stats_dio_tx = 0;
        this.stats_dis_tx = 0;
        this.stats_dao_tx = 0;
        this.stats_dao_fwd = 0;
        this.stats_dao_ack_tx = 0;
        this.stats_dio_rx = 0;
        this.stats_dis_rx = 0;
        this.stats_dao_rx = 0;
        this.stats_dao_ack_rx = 0;
        /* statistics: joining */
        this.stats_join_time_sec = null;
        this.stats_num_parent_changes = 0;

        this.dio_timer = null;
        this.dao_timer = null;
        this.dis_timer = null;
        this.probing_timer = null;
        this.leave_timer = null;

        this.rpl_timers_schedule_periodic_dis();

        mlog(log.DEBUG, this.node, `RPL start, using ${this.node.config.RPL_OBJECTIVE_FUNCTION === "MRHOF" ? "MRHOF" : "OF0"} objective function`);
    }

    start() {
        if (this.node.is_coordinator) {
            /* start root operation */
            this.create_dodag();
            this.rank = ROOT_RANK();
            this.state = DAG_REACHABLE;
            this.dio_intcurrent = 0;
            this.rpl_timers_dio_reset();
            this.reset_routes();
            this.rpl_dag_update_state();
            this.stats_join_time_sec = round_to_ms(time.timeline.seconds);
        } else {
            /* start non-root operation */
            this.dis_output(constants.BROADCAST_ID);
        }
    }

    on_tx(neighbor, packet, is_ok, is_ack_required, cell) {
        /* If this is the neighbor we were probing urgently, mark urgent probing as done */
        if (this.urgent_probing_target && this.urgent_probing_target.neighbor === neighbor) {
            this.urgent_probing_target = null;
        }
        if (this.state > DAG_UNUSED) {
            let etx_could_be_changed;
            if (config.EMULATE_6TISCHSIM) {
                etx_could_be_changed = cell && cell.is_dedicated();
            } else {
                etx_could_be_changed = true;
            }

            if (etx_could_be_changed) {
                if (this.preferred_parent && neighbor === this.preferred_parent.neighbor) {
                    /* Make sure our rank is up to date */
                    this.rank = this.of_rank_via_nbr(this.preferred_parent);
                }
                /* TODO: add optimization: if not from the preferred parent,
                   just compare the neighbor rank with our rank and decide if need to switch */
                this.rpl_dag_update_state();
            }
        }
    }

    on_prepare_tx_packet(packet) {
        if (packet.rpl_opt_flags !== undefined) {
            /* already set in on_forward */
            return;
        }

        /* add the ext header with hop-by-hop options (no need to preserve in packet.copy()) */
        packet.rpl_opt_flags = 0;
        packet.rpl_senderrank = this.rank;

        const route = this.node.routes.get_route(packet.destination_id);
        if (route) {
            /* A DAO route was found so we set the down flag. */
            packet.rpl_opt_flags |= RPL_HDR_OPT_DOWN;
            mlog(log.DEBUG, this.node, `going down according to RPL: from=${this.node.id} to=${route.nexthop_id}`);
        }
    }

    on_forward(packet, new_packet) {
        let do_forward = true;

        /* check the ext header check */
        const is_down = (packet.rpl_opt_flags & RPL_HDR_OPT_DOWN) ? true : false;
        const sender_rank = packet.rpl_senderrank;
        const rank_error_signaled = (packet.rpl_opt_flags & RPL_HDR_OPT_RANK_ERR) ? true : false;
        const is_sender_closer = sender_rank < this.rank;
        const is_loop_detected = (is_down && !is_sender_closer) || (!is_down && is_sender_closer);
        const sender = this.get_rpl_neighbor(packet.lasthop_id);

        let rpl_opt_flags = packet.rpl_opt_flags;

        /* Check the direction of the down flag, as per Section 11.2.2.3,
            which states that if a packet is going down it should in
            general not go back up again. If this happens, a
            RPL_HDR_OPT_FWD_ERR should be flagged. */
        if (is_down) {
            if (!this.node.routes.get_route(packet.destination_id)) {
                rpl_opt_flags |= RPL_HDR_OPT_FWD_ERR;
                mlog(log.WARNING, this.node, `RPL forwarding error`);
                /* We should send back the packet to the originating parent,
                   but it is not feasible yet, so we send a No-Path DAO instead */
                mlog(log.WARNING, this.node, `RPL generate No-Path DAO`);
                this.dao_output(sender, RPL_ZERO_LIFETIME);
                /* Drop packet */
                return false;
            }
        } else {
            /* Set the down extension flag correctly as described in Section
               11.2 of RFC6550. If the packet progresses along a DAO route,
               the down flag should be set. */
            const route = this.node.routes.get_route(packet.destination_id);
            if (route) {
                /* A DAO route was found so we set the down flag. */
                rpl_opt_flags |= RPL_HDR_OPT_DOWN;
                mlog(log.DEBUG, this.node, `going down according to RPL: via=${packet.lasthop_id}->${this.node.id}->${route.nexthop_id}`);
            } else {
                /* No route was found, so this packet will go towards the RPL
                   root. If so, we should not set the down flag. */
                rpl_opt_flags &= ~RPL_HDR_OPT_DOWN;
                const nexthop_id = this.node.routes.default_route ? this.node.routes.default_route.nexthop_id : -1;
                mlog(log.DEBUG, this.node, `going up according to RPL: via=${packet.lasthop_id}->${this.node.id}->${nexthop_id}`);
            }
        }

        new_packet.rpl_opt_flags = rpl_opt_flags;
        new_packet.rpl_senderrank = this.rank;

        if (is_loop_detected) {
            if (rank_error_signaled) {
                if (this.node.config.RPL_LOOP_ERROR_DROP) {
                    this.rpl_timers_dio_reset();
                    mlog(log.WARNING, this.node, "rank error and loop detected, dropping");
                    /* do not forward the packet */
                    do_forward = false;
                } else {
                    mlog(log.INFO, this.node, "loop detected, attempting repair");
                }
                /* Attempt to repair the loop by sending a unicast DIO back to the sender
                 * so that it gets a fresh update of our rank. */
                this.dio_output(sender.neighbor.id);
            } else {
                mlog(log.INFO, this.node, "loop detected, ignoring the first time");
            }

            /* Set forward error flag */
            new_packet.rpl_opt_flags |= RPL_HDR_OPT_RANK_ERR;
        }

        if (rank_error_signaled) {
            /* A rank error was signalled, attempt to repair it by updating
             * the sender's rank from ext header */
            sender.rank = sender_rank;
            /* Select DAG and preferred parent. In case of a parent switch,
               the new parent will be used to forward the current packet. */
            this.rpl_dag_update_state();
        }

        return do_forward;
    }

    on_new_time_source(old_time_source, new_time_source) {
        if (new_time_source != null) {
            assert(this.preferred_parent == null
                   || this.preferred_parent.neighbor === new_time_source,
                   `preferred parent mismatch: ${this.preferred_parent ? this.preferred_parent.neighbor : null} vs ${new_time_source}`);
        }
    }

    is_root() {
        return this.state > DAG_UNUSED && this.rank === ROOT_RANK();
    }

    is_joined() {
        return this.state >= DAG_JOINED;
    }

    is_leaf() {
        return this.node.config.ROUTING_IS_LEAF;
    }

    get_rpl_neighbor(id) {
        if (!this.rpl_neighbors.has(id)) {
            const neighbor = this.node.ensure_neighbor(id);
            this.rpl_neighbors.set(id, new RPLNeighbor(neighbor));
        }
        return this.rpl_neighbors.get(id);
    }

    /*---------------------------------------------------------------------------*/
    /* RPL DAG and route functions */

    /* initialize a new DODAG, rooted at this node */
    create_dodag() {
        this.version = RPL_LOLLIPOP_INCREMENT(this.version);
        this.dtsn_out = RPL_LOLLIPOP_INIT;
        this.state = DAG_INITIALIZED;

        this.rank = RPL_INFINITE_RANK;
        this.last_advertised_rank = RPL_INFINITE_RANK;
        this.lowest_rank = RPL_INFINITE_RANK;
        this.dao_last_seqno = RPL_LOLLIPOP_INIT;
        this.dao_last_acked_seqno = RPL_LOLLIPOP_INIT;
        this.dao_last_seqno = RPL_LOLLIPOP_INIT;
    }

    rpl_dag_leave() {
        mlog(log.WARNING, this.node, "leaving DAG");

        /* Issue a no-path DAO */
        if (!this.is_root()) {
            this.dao_last_seqno = RPL_LOLLIPOP_INCREMENT(this.dao_last_seqno);
            this.dao_output(this.preferred_parent, RPL_ZERO_LIFETIME);
        }

        /* Forget past link statistics */
        this.node.reset_link_stats();

        /* Remove all neighbors, links and default route */
        this.neighbor_remove_all();

        /* Stop all timers */
        this.rpl_timers_stop_dag_timers();

        /* Mark instance as unused */
        this.state = DAG_UNUSED;
    }

    rpl_dag_poison_and_leave() {
        this.state = DAG_POISONING;
        this.rpl_dag_update_state();
    }

    rpl_dag_ready_to_advertise() {
        return this.state >= DAG_REACHABLE;
    }

    rpl_dag_update_state() {
        if (this.state === DAG_UNUSED) {
            return;
        }

        if (this.in_state_update) {
            return;
        }
        this.in_state_update = true;

        const old_rank = this.rank;

        if (this.state === DAG_POISONING) {
            this.set_preferred_parent(null);
            this.rank = RPL_INFINITE_RANK;
            if (old_rank !== RPL_INFINITE_RANK) {
                /* Advertise that we are leaving, and leave after a delay */
                mlog(log.WARNING, this.node, "poisoning and leaving after a delay");
                this.rpl_timers_dio_reset();
                this.rpl_timers_schedule_leaving();
            }
        } else if (!this.is_root()) {
            const old_parent = this.preferred_parent;

            /* Select and set preferred parent */
            this.set_preferred_parent(this.rpl_neighbor_select_best());
            /* Update rank */
            this.rank = this.preferred_parent ? this.of_rank_via_nbr(this.preferred_parent) : RPL_INFINITE_RANK;
            if (this.preferred_parent) {
                mlog(log.DEBUG, this.node, `new rank is ${this.rank}, parent rank=${this.preferred_parent.rank}`);
            } else {
                mlog(log.DEBUG, this.node, `new rank is ${this.rank}, no parent`);
            }

            /* Update better_parent_since flag for each neighbor */
            this.neighbor_set_better_parent_states();

            if (!old_parent || this.rank < this.lowest_rank) {
                /* This is a slight departure from RFC6550: if we had no preferred parent before,
                 * reset lowest_rank. This helps recovering from temporary bad link conditions. */
                this.lowest_rank = this.rank;
            }

            /* Reset DIO timer in case of significant rank update */
            if (this.last_advertised_rank !== RPL_INFINITE_RANK
                && this.rank !== RPL_INFINITE_RANK
                && Math.abs(this.rank - this.last_advertised_rank) > this.node.config.RPL_SIGNIFICANT_CHANGE_THRESHOLD) {
                mlog(log.WARNING, this.node, `significant rank update ${this.last_advertised_rank} -> ${this.rank}`);
                /* Update already here to avoid multiple resets in a row */
                this.last_advertised_rank = this.rank;
                this.rpl_timers_dio_reset();
            }

            /* Parent switch */
            if (this.unprocessed_parent_switch) {
                if (this.preferred_parent) {
                    /* We just got a parent (was NULL), reset trickle timer to advertise this */
                    if (!old_parent) {
                        this.state = DAG_JOINED;
                        this.rpl_timers_dio_reset();
                        mlog(log.DEBUG, this.node, `found parent ${this.neighbor_print(this.preferred_parent)}, staying in DAG`);
                        this.rpl_timers_unschedule_leaving();
                    }
                    /* Schedule a DAO */
                    this.rpl_timers_schedule_dao();
                } else {
                    /* We have no more parent, schedule DIS to get a chance to hear updated state */
                    this.state = DAG_INITIALIZED;
                    mlog(log.DEBUG, this.node, `no parent, scheduling periodic DIS, will leave if no parent is found`);
                    this.rpl_timers_dio_reset();
                    this.rpl_timers_schedule_periodic_dis();
                    this.rpl_timers_schedule_leaving();
                }

                /* Clear unprocessed_parent_switch now that we have processed it */
                this.unprocessed_parent_switch = false;
            }
        }
        this.in_state_update = false;
    }

    rpl_refresh_routes() {
        if (this.is_root()) {
            /* Increment DTSN */
            this.dtsn_out = this.RPL_LOLLIPOP_INCREMENT(this.dtsn_out);
        }
    }

    reset_routes() {
        /* remove all routes */
        this.node.routes.clear();
    }

    rpl_global_repair() {
        if (this.is_root()) {
            /* New DAG version */
            this.version = RPL_LOLLIPOP_INCREMENT(this.version);
            /* Re-initialize DTSN */
            this.dtsn_out = RPL_LOLLIPOP_INIT;

            mlog(log.WARNING, this.node, `initiating global repair, version ${this.version}, rank ${this.rank}`);

            /* Now do a local repair to disseminate the new version */
            this.local_repair(false);
        }
    }

    global_repair_non_root(dio) {
        if (!this.is_root()) {
            mlog(log.WARNING, this.node, `participating in global repair, version ${this.version}, rank ${this.rank}`);
            /* Re-initialize configuration from DIO */
            this.rpl_timers_stop_dag_timers();
            this.set_preferred_parent(null);
            /* This will both re-init the DAG and schedule required timers */
            this.init_dag_from_dio(dio);
            this.local_repair(false);
        }
    }

    local_repair(is_from_init) {
        if (this.state > DAG_UNUSED) {
            if (!is_from_init) {
                mlog(log.WARNING, this.node, `local repair`);
            }
            if (!this.is_root()) {
                this.state = DAG_INITIALIZED; /* Reset DAG state */
            }
            this.neighbor_remove_all(); /* Remove all neighbors */
            this.rpl_timers_dio_reset(); /* Reset Trickle timer */
            this.rpl_dag_update_state();
        }
    }

    /*---------------------------------------------------------------------------*/
    /* React on RPL messages */

    init_dag_from_dio(dio) {
        this.create_dodag();
        this.dag_id = dio.source.id;
        this.version = dio.payload.version;
        /* dio_intcurrent will be reset by rpl_timers_dio_reset() */
        this.dio_intcurrent = 0;

        this.rpl_timers_dio_reset();
        this.rpl_schedule_probing();
        mlog(log.DEBUG, this.node, "just joined, no parent yet, setting timer for leaving");
        this.rpl_timers_schedule_leaving();
    }

    update_nbr_from_dio(from_id, dio) {
        const rpl_neighbor = this.get_rpl_neighbor(from_id);

        mlog(log.DEBUG, this.node, `update nbr ${from_id} from DIO, rank=${dio.payload.rank} dtsn=${dio.payload.dtsn}`);

        /* Update neighbor info from DIO */
        rpl_neighbor.rank = dio.payload.rank;
        rpl_neighbor.dtsn = dio.payload.dtsn;
        return rpl_neighbor;
    }

    process_dio_from_current_dag(from_id, dio) {

        /* Does the rank make sense at all? */
        if (dio.payload.rank < ROOT_RANK()) {
            mlog(log.WARNING, this.node, `bogus DIO rank ${dio.payload.rank}`);
            return;
        }

        /* If the DIO sender is on an older version of the DAG, do not process it
         * further. The sender will eventually hear the global repair and catch up. */
        if (rpl_lollipop_greater_than(this.version, dio.payload.version)) {
            mlog(log.WARNING, this.node, `got old DIO, version ${dio.payload.version}, my version ${this.version}`);
            if (dio.payload.rank === ROOT_RANK()) {
                /* Before returning, if the DIO was from the root, an old DAG versions
                 * likely incidates a root reboot. Reset our DIO timer to make sure the
                 * root hears our version ASAP, and in turn triggers a global repair. */
                this.rpl_timers_dio_reset();
            }
            return;
        }

        /* The DIO is valid, proceed further */

        /* Update DIO counter for redundancy mngt */
        if (dio.payload.rank !== RPL_INFINITE_RANK) {
            this.dio_counter += 1;
        }

        /* The DIO has a newer version: global repair.
         * Must come first, as it might remove all neighbors, and we then need
         * to re-add this source of the DIO to the neighbor table */
        if (rpl_lollipop_greater_than(dio.payload.version, this.version)) {
            if (this.rank === ROOT_RANK()) {
                /* The root should not hear newer versions unless it just rebooted */
                mlog(log.ERROR, this.node, `inconsistent DIO version (current: ${this.version}, received: ${dio.payload.version}), initiate global repair`);
                /* Update version and trigger global repair */
                this.version = dio.payload.version;
                this.rpl_global_repair();
            } else {
                mlog(log.WARNING, this.node, `inconsistent DIO version (current: ${this.version}, received: ${dio.payload.version}), apply global repair`);
                this.global_repair_non_root(dio);
            }
        }

        /* Update IPv6 neighbor cache */
        /* XXX: not necessary at the moment */
        /* if (!rpl_icmp6_update_nbr_table(from, NBR_TABLE_REASON_RPL_DIO, dio)) {
            LOG_ERR("IPv6 cache full, dropping DIO");
            return;
        } */

        const nbr = this.get_rpl_neighbor(from_id);
        const last_dtsn = nbr.dtsn;

        /* Add neighbor to RPL neighbor table */
        this.update_nbr_from_dio(from_id, dio);

        /* If the source is our preferred parent and it increased DTSN, we increment
         * our DTSN in turn and schedule a DAO (see RFC6550 section 9.6.) */
        if (nbr === this.preferred_parent && rpl_lollipop_greater_than(dio.payload.dtsn, last_dtsn)) {
            this.dtsn_out = RPL_LOLLIPOP_INCREMENT(this.dtsn_out);
            mlog(log.WARNING, this.node, `DTSN increment ${last_dtsn}->${dio.payload.dtsn}, schedule new DAO with DTSN ${this.dtsn_out}`);
            this.rpl_timers_schedule_dao();
        }
    }

    rpl_process_dio(from_id, dio) {
        if (this.state === DAG_UNUSED && !this.is_root()) {
            /* Attempt to init our DAG from this DIO */
            this.init_dag_from_dio(dio);
        }

        if (this.state > DAG_UNUSED) {
            this.process_dio_from_current_dag(from_id, dio);
            this.rpl_dag_update_state();
        }
    }

    rpl_process_dis(from_id, is_multicast) {
        if (is_multicast) {
            this.rpl_timers_dio_reset();
        } else {
            /* Add neighbor to cache and reply to the unicast DIS with a unicast DIO*/
            /* XXX: not necessary at the moment, simply do dio_output unconditionally */
            /* if (rpl_icmp6_update_nbr_table(from, NBR_TABLE_REASON_RPL_DIS, NULL) != NULL) {
                LOG_INFO("unicast DIS, reply to sender");
                this.dio_output(from_id);
            } */
            this.dio_output(from_id);
        }
    }

    rpl_process_dao(dao) {
        if (dao.payload.lifetime === RPL_ZERO_LIFETIME) {
            /* No-Path DAO received; invoke the route purging routine. */
            this.node.remove_route(dao.payload.prefix);
        } else {
            const route = this.node.add_route(dao.payload.prefix, dao.source.id);
            route.lifetime = dao.payload.lifetime;
        }

        if (this.node.config.RPL_WITH_DAO_ACK) {
            if (dao.payload.flags & RPL_DAO_K_FLAG) {
                this.rpl_timers_send_dao_ack(dao.source.id, dao.payload.sequence);
            }
        }

        /* forward the DAO to parent (needed in the storing mode) */
        if (this.preferred_parent) {
            this.stats_dao_fwd += 1;
            dao.payload.flags = 0;
            if (this.node.config.RPL_WITH_DAO_ACK) {
                dao.payload.flags |= RPL_DAO_K_FLAG;
            }
            /* Send to the parent (in non-storing mode, would send to the root) */
            this.icmp6_send(this.preferred_parent.neighbor.id, RPL_CODE_DAO, dao.payload, PKT_LEN_DAO);
        }
    }

    rpl_process_dao_ack(sequence, status) {
        mlog(log.INFO, this.node, `got DAO ACK seqno ${sequence} (our ${this.dao_last_seqno}), status ${status}`);

        /* Update dao_last_acked_seqno */
        if (rpl_lollipop_greater_than(sequence, this.dao_last_acked_seqno)) {
            this.dao_last_acked_seqno = sequence;
        }

        /* Is this an ACK for our last DAO? */
        if (sequence === this.dao_last_seqno) {
            const status_ok = status < RPL_DAO_ACK_UNABLE_TO_ACCEPT;
            if (this.state === DAG_JOINED && status_ok) {
                this.state = DAG_REACHABLE;
                this.rpl_timers_dio_reset();
            }
            /* Let the rpl-timers module know that we got an ACK for the last DAO */
            this.rpl_timers_notify_dao_ack();

            if (!status_ok) {
                /* We got a NACK, start poisoning and leave */
                mlog(log.WARNING, this.node, `DAO-NACK received with seqno ${sequence}, status ${status}, poison and leave`);
                this.state = DAG_POISONING;
            }
        }
    }

    /*---------------------------------------------------------------------------*/
    /* RPL neighbor functions */

    neighbor_max_acceptable_rank() {
        if (this.node.config.RPL_MAX_RANKINC === 0) {
            /* There is no max rank increment */
            return RPL_INFINITE_RANK;
        }
        /* Make sure not to exceed RPL_INFINITE_RANK */
        return Math.min(this.lowest_rank + this.node.config.RPL_MAX_RANKINC, RPL_INFINITE_RANK);
    }

    /* As per RFC 6550, section 8.2.2.4 */
    neighbor_has_acceptable_rank(nbr) {
        const rank = this.of_rank_via_nbr(nbr);
        if (rank === RPL_INFINITE_RANK) {
            return false;
        }
        if (rank < ROOT_RANK()) {
            return false;
        }

        if (config.EMULATE_CONTIKI) {
            /* Use Contiki-NG approach (does not work well, may lead to loops!) */
            return rank <= this.neighbor_max_acceptable_rank();
        } else {
            /*
             * Use approach from the OpenWSN 6tisch simulator:
             * a parent should have a lower rank than us by MinHopRankIncrease at
             *  least. See section 3.5.1 of RFC 6550:
             * "MinHopRankIncrease is the minimum increase in Rank between a node
             *  and any of its DODAG parents."
             */
            /* mlog(log.DEBUG, this.node, `this.rank-nbr.rank=${this.rank - nbr.rank} r=${this.node.config.RPL_MIN_HOPRANKINC <= this.rank - nbr.rank}`); */
            return this.node.config.RPL_MIN_HOPRANKINC <= this.rank - nbr.rank;
        }
    }

    neighbor_is_fresh(nbr) {
        return nbr.neighbor.link_stats_is_fresh();
    }

    neighbor_remove(nbr) {
        /* Make sure we don't point to a removed neighbor. Note that we do not need
           to worry about preferred_parent here, as it is locked in the the table
           and will never be removed by external modules. */
        if (nbr === this.urgent_probing_target) {
            this.urgent_probing_target = null;
        }

        if (nbr === this.unicast_dio_target) {
            this.unicast_dio_target = null;
        }
        this.rpl_neighbors.delete(nbr.neighbor.id);
    }

    neighbor_remove_all(nbr) {
        /* Unset preferred parent before we de-allocate it. This will set
         * unprocessed_parent_switch which will make sure rpl_dag_update_state takes
         * all actions necessary after losing the preferred parent */
        this.set_preferred_parent(null);

        while (this.rpl_neighbors.size) {
            this.neighbor_remove(this.rpl_neighbors.entries().next().value[1]);
        }

        /* Update needed immediately. As we have lost the preferred parent this will
         * enter poisoining and set timers accordingly. */
        this.rpl_dag_update_state();
    }

    neighbor_is_parent(nbr) {
        return nbr.rank < this.rank;
    }

    neighbor_print(nbr) {
        if (nbr) {
            return `${nbr.neighbor.id}`
        }
        return "null";
    }

    /* Update better_parent_since flag for each neighbor */
    neighbor_set_better_parent_states() {
        for (const [_, nbr] of this.rpl_neighbors) {
            const rank = this.of_rank_via_nbr(nbr);

            if (rank < this.rank) {
                /* This neighbor would be a better parent than our current.
                   Set 'better_parent_since' if not already set. */
                if (nbr.better_parent_since == null) {
                    nbr.better_parent_since = time.timeline.seconds; /* Initialize */
                }
            } else {
                nbr.better_parent_since = null; /* Not a better parent */
            }
        }
    }

    set_preferred_parent(nbr) {
        if (this.preferred_parent !== nbr) {
            mlog(log.INFO, this.node, `parent switch: ${this.neighbor_print(this.preferred_parent)} -> ${this.neighbor_print(nbr)}`);

            /* Update the default route. Use an infinite lifetime */
            this.node.routes.remove_default_route();
            if (nbr) {
                this.node.routes.add_default_route(nbr.neighbor.id);
            } else {
                mlog(log.ERROR, this.node, `drop preferred parent: rank=${this.preferred_parent.rank} link=${this.preferred_parent.link_metric()}`);
            }

            this.preferred_parent = nbr;
            this.unprocessed_parent_switch = true;
            if (nbr != null && this.stats_join_time_sec == null) {
                /* joined for the first time */
                this.stats_join_time_sec = round_to_ms(time.timeline.seconds);
            }
            this.stats_num_parent_changes += 1;

            /* notify TSCH */
            const old_neighbor = this.preferred_parent ? this.preferred_parent.neighbor : null;
            const new_neighbor = nbr ? nbr.neighbor : null;
            this.node.on_parent_switch(old_neighbor, new_neighbor);
        }
    }

    best_parent(fresh_only) {
        let best = null;

        if (this.state === DAG_UNUSED) {
            return null;
        }

        /* mlog(log.INFO, this.node, `elect best parent (fresh_only=${fresh_only})`); */

        /* Search for the best parent according to the OF */
        for (const [_, nbr] of this.rpl_neighbors) {

            if (!this.neighbor_has_acceptable_rank(nbr)
                || !this.of_nbr_is_acceptable_parent(nbr)) {
                /* Exclude neighbors with a rank that is not acceptable */
                /* mlog(log.DEBUG, this.node, `nbr ${nbr.neighbor.id} is not acceptable, rank=${nbr.rank} rank_via=${this.of_rank_via_nbr(nbr)} etx=${nbr.neighbor.floating_point_etx()}`); */
                continue;
            }

            if (fresh_only && !this.neighbor_is_fresh(nbr)) {
                /* Filter out non-fresh nerighbors if fresh_only is set */
                continue;
            }

            /* Now we have an acceptable parent, check if it is the new best */
            if (best == null) {
                best = nbr;
            } else {
                best = this.of_best_parent(best, nbr);
            }
        }

        return best;
    }

    rpl_neighbor_select_best() {
        if (this.is_root()) {
            return null; /* The root has no parent */
        }

        mlog(log.DEBUG, this.node, `Neighbors (* denotes acceptable):`);
        for (const [_, nbr] of this.rpl_neighbors) {
            const is_acceptable = this.neighbor_has_acceptable_rank(nbr)
                  && this.of_nbr_is_acceptable_parent(nbr);
            mlog(log.DEBUG, this.node, `${is_acceptable ? "*" : " "} nbr=${nbr.neighbor.id} rank=${nbr.rank} rank_via=${this.of_rank_via_nbr(nbr)} etx=${nbr.neighbor.floating_point_etx()}`);
            if (!is_acceptable) {
                mlog(log.DEBUG, this.node, `    rank_ok=${this.neighbor_has_acceptable_rank(nbr)} parent_ok=${this.of_nbr_is_acceptable_parent(nbr)} etx=${nbr.neighbor.floating_point_etx().toFixed(2)}`);
            }
        }

        /* Look for best parent (regardless of freshness) */
        const best = this.best_parent(false);
        if (!best) {
            /* No acceptable parent */
            mlog(log.WARNING, this.node, `no acceptable parent`);
            return null;
        }

        if (!this.node.config.RPL_WITH_PROBING) {
            /* do not require the freshness check */
            return best;
        }

        if (this.neighbor_is_fresh(best)) {
            /* Unschedule any already scheduled urgent probing */
            this.urgent_probing_target = null;
            /* Return best if it is fresh */
            return best;
        }

        if (this.node.config.RPL_WITH_PROBING) {
            /* The best is not fresh. Probe it (unless there is already an urgent
               probing target). We will be called back after the probing anyway. */
            if (!this.urgent_probing_target) {
                mlog(log.DEBUG, this.node, `best parent is not fresh, schedule urgent probing`);
                this.urgent_probing_target = best;
                this.rpl_schedule_probing_now();
            }
        }

        /* The best is our preferred parent. It is not fresh but used to be,
           else we would not have selected it in the first place. Stick to it
           for a little while and rely on urgent probing to make a call. */
        if (best === this.preferred_parent) {
            return best;
        }

        /* Look for the best fresh parent. */
        const best_fresh = this.best_parent(true);
        if (best_fresh) {
            /* Select best fresh */
            return best_fresh;
        }

        if (this.preferred_parent) {
            /* We already have a parent, now stick to the best and count on
               urgent probing to get a fresh parent soon */
            return best;
        }

        /* We will wait to find a fresh node before selecting our first parent */
        mlog(log.DEBUG, this.node, `no fresh parent`);
        return null;
    }

    /*---------------------------------------------------------------------------*/
    /* Objective function specific functions */

    of_rank_via_nbr(nbr) {
        return this.node.config.RPL_OBJECTIVE_FUNCTION === "MRHOF" ?
            this.mrhof_rank_via_nbr(nbr) :
            this.of0_rank_via_nbr(nbr);
    }

    of_nbr_path_cost(nbr) {
        return this.node.config.RPL_OBJECTIVE_FUNCTION === "MRHOF" ?
            this.mrhof_nbr_path_cost(nbr) :
            this.of0_nbr_path_cost(nbr);
    }

    of_nbr_is_acceptable_parent(nbr) {
        return this.node.config.RPL_OBJECTIVE_FUNCTION === "MRHOF" ?
            this.mrhof_nbr_is_acceptable_parent(nbr) :
            this.of0_nbr_is_acceptable_parent(nbr);
    }

    of_best_parent(a, b) {
        return this.node.config.RPL_OBJECTIVE_FUNCTION === "MRHOF" ?
            this.mrhof_best_parent(a, b) :
            this.of0_best_parent(a, b);
    }

    /*---------------------------------------------------------------------------*/
    /* OF0 objective function implementation */

    of0_rank_via_nbr(nbr) {
        return Math.min(nbr.rank + this.of0_nbr_rank_increase(nbr), RPL_INFINITE_RANK);
    }

    of0_nbr_rank_increase(nbr) {
        const min_hoprankinc = this.node.config.RPL_MIN_HOPRANKINC;
        const step = this.of0_step_of_rank(nbr);
        const result = (OF0_RANK_FACTOR * step + OF0_RANK_STRETCH) * min_hoprankinc;
        /* mlog(log.DEBUG, this.node, `for ${nbr.neighbor.id}: metric=${nbr.link_metric()} increase=${result}`); */
        return result;
    }

    of0_nbr_path_cost(nbr) {
        return Math.min(nbr.rank + nbr.link_metric(), RPL_INFINITE_RANK);
    }

    of0_step_of_rank(nbr) {
        /* Numbers suggested by P. Thubert for in the 6TiSCH WG. Anything that maps ETX to
         * a step between 1 and 9 works. */
        return Math.trunc(3 * nbr.neighbor.floating_point_etx() - 2);
    }

    of0_nbr_is_acceptable_parent(nbr) {
        if (!nbr) {
            return null;
        }
        const step = this.of0_step_of_rank(nbr);
        /* mlog(log.DEBUG, this.node, `for ${nbr.neighbor.id}: step=${step}`); */
        return step >= OF0_MIN_STEP_OF_RANK && step <= OF0_MAX_STEP_OF_RANK;
    }

    of0_best_parent(a, b) {
        const a_is_acceptable = this.of0_nbr_is_acceptable_parent(a);
        const b_is_acceptable = this.of0_nbr_is_acceptable_parent(b);

        if (!a_is_acceptable) {
            return b_is_acceptable ? b : null;
        }
        if (!b_is_acceptable) {
            return a;
        }

        if (config.EMULATE_CONTIKI) {
            /* Use Contiki-NG approach (does not work well, may lead to loops!) */
            const a_cost = this.of0_nbr_path_cost(a);
            const b_cost = this.of0_nbr_path_cost(b);

            /* We operate without hysteresis, as in Contiki-NG RPL-Lite */
            if (a_cost != b_cost) {
                /* Pick neighbor with lowest path cost */
                return a_cost < b_cost ? a : b;
            }

            /* We have a tie! */
            /* Stick to current preferred parent if possible */
            if (a === this.preferred_parent || b === this.preferred_parent) {
                return this.preferred_parent;
            }

            /* None of the nodes is the current preferred parent,
             * choose nbr with best link metric */
            return a.link_metric() < b.link_metric() ? a : b;
        }

        /* Use OpenWSN 6tisch simulator logic */
        let a_rank = a.rank;
        let b_rank = b.rank;
        if (a === this.preferred_parent) {
            b_rank += OF0_PARENT_SWITCH_RANK_INCREASE_THRESHOLD();
        } else if (b === this.preferred_parent) {
            a_rank += OF0_PARENT_SWITCH_RANK_INCREASE_THRESHOLD();
        }

        return a_rank < b_rank ? a : b;
    }

    /*---------------------------------------------------------------------------*/
    /* MRHOF objective function implementation */

    mrhof_rank_via_nbr(nbr) {
        const min_hoprankinc = this.node.config.RPL_MIN_HOPRANKINC;
        const path_cost = this.mrhof_nbr_path_cost(nbr);

        /* Rank lower-bound: nbr rank + min_hoprankinc */
        return Math.max(Math.min(nbr.rank + min_hoprankinc, RPL_INFINITE_RANK), path_cost);
    }

    mrhof_nbr_path_cost(nbr) {
        return Math.min(nbr.rank + nbr.link_metric(), RPL_INFINITE_RANK);
    }

    mrhof_nbr_is_acceptable_parent(nbr) {
        /* Exclude links with too high link metrics  */
        const has_usable_link = nbr.link_metric() <= MRHOF_MAX_LINK_METRIC;
        const path_cost = this.mrhof_nbr_path_cost(nbr);
        /* Exclude links with too high link metrics or path cost (RFC6719, 3.2.2) */
        return has_usable_link && path_cost <= MRHOF_MAX_PATH_COST;
    }

    mrhof_within_hysteresis(nbr) {
        const path_cost = this.mrhof_nbr_path_cost(nbr);
        const parent_path_cost = this.mrhof_nbr_path_cost(this.preferred_parent);

        const within_rank_hysteresis = path_cost + MRHOF_RANK_THRESHOLD > parent_path_cost;
        const within_time_hysteresis = nbr.better_parent_since == null
              || (time.timeline.seconds - nbr.better_parent_since) <= MRHOF_TIME_THRESHOLD_SEC;

        /* As we want to consider neighbors that are either beyond the rank or time
           hystereses, return 1 here iff the neighbor is within both hystereses. */
        return within_rank_hysteresis && within_time_hysteresis;
    }

    mrhof_best_parent(a, b) {
        const a_is_acceptable = this.mrhof_nbr_is_acceptable_parent(a);
        const b_is_acceptable = this.mrhof_nbr_is_acceptable_parent(b);

        if (!a_is_acceptable) {
            return b_is_acceptable ? b : null;
        }
        if (!b_is_acceptable) {
            return a;
        }

        /* Maintain stability of the preferred parent. Switch only if the gain
           is greater than MRHOF_RANK_THRESHOLD, or if the neighbor has been better than the
           current parent for at more than MRHOF_TIME_THRESHOLD_SEC. */
        if (a == this.preferred_parent && this.mrhof_within_hysteresis(b)) {
            return a;
        }
        if (b == this.preferred_parent && this.mrhof_within_hysteresis(a)) {
            return b;
        }

        return this.mrhof_nbr_path_cost(a) < this.mrhof_nbr_path_cost(b) ? a : b;
    }

    /*------------------------------- DIS -------------------------------------- */

    rpl_timers_schedule_periodic_dis() {
        if (!this.dis_timer) {
            const expiration_time = rng.trickle_random(config.RPL_DIS_INTERVAL_SEC);
            this.dis_timer = time.add_timer(expiration_time, false, this, function(rpl) {
                rpl.handle_dis_timer();
            });
        }
    }

    handle_dis_timer() {
        this.dis_timer = null;
        if (!this.is_root()
            &&(this.state === DAG_UNUSED
               || !this.preferred_parent
               || this.rank === RPL_INFINITE_RANK)) {
            this.dis_output(constants.BROADCAST_ID);
            this.rpl_timers_schedule_periodic_dis();
        }
    }

    /*------------------------------- DIO -------------------------------------- */

    new_dio_interval() {
        const time_sec = (1 << this.dio_intcurrent) / 1000;

        /* random number between I/2 and I */
        this.dio_next_delay = rng.trickle_random(time_sec);

        this.dio_send = true;
        /* reset the redundancy counter */
        this.dio_counter = 0;

        /* schedule the timer */
        this.schedule_dio_timer();

        /* notify TSCH */
        const rank = Math.round(this.rank / this.node.config.RPL_MIN_HOPRANKINC);
        this.node.on_new_dio_interval(time_sec, rank, this.is_root());
    }

    schedule_dio_timer() {
        if (this.dio_timer) {
            time.remove_timer(this.dio_timer);
        }
        this.dio_timer = time.add_timer(this.dio_next_delay, false, this, function(rpl) {
            rpl.handle_dio_timer(); });
    }

    rpl_timers_dio_reset() {
        if (!this.rpl_dag_ready_to_advertise()) {
            /* will be called again later */
            return;
        }

        if (this.dio_intcurrent == 0
            || this.dio_intcurrent > this.node.config.RPL_DIO_INTERVAL_MIN) {
            mlog(log.DEBUG, this.node, `reset DIO timer`);
            if (!this.is_leaf()) {
                this.dio_counter = 0;
                this.dio_intcurrent = this.node.config.RPL_DIO_INTERVAL_MIN;
                this.new_dio_interval();
            }
        } else {
            /*
             * Don't reset the DIO timer if the current interval is Imin; see
             * Section 4.2, RFC 6206.
             * Still, need to make sure the timer is running.
             */
            if (!this.dio_timer) {
                this.schedule_dio_timer();
            }
        }
    }

    handle_dio_timer() {
        this.dio_timer = null;
        if (!this.rpl_dag_ready_to_advertise()) {
            return; /* We will be scheduled again later */
        }

        if (this.dio_send) {
            /* send DIO if counter is less than desired redundancy, or if dio_redundancy
               is set to 0, or if we are the root */
            if (this.is_root()
                || this.node.config.RPL_DIO_REDUNDANCY === 0
                || this.dio_counter < this.node.config.RPL_DIO_REDUNDANCY) {
                this.last_advertised_rank = this.rank;
                this.dio_output(constants.BROADCAST_ID);
            }
            this.dio_send = false;
            if (this.dio_timer) {
                time.remove_timer(this.dio_timer);
            }
            this.dio_timer = time.add_timer(this.dio_next_delay, false, this, function(rpl) {
                rpl.handle_dio_timer(); });
        } else {
            /* check if we need to double interval */
            if (this.dio_intcurrent < this.node.config.RPL_DIO_INTERVAL_MIN + this.node.config.RPL_DIO_INTERVAL_DOUBLINGS) {
                this.dio_intcurrent += 1;
            }
            this.new_dio_interval();
        }
    }

    /*------------------------------- DAO -------------------------------------- */

    schedule_dao_retransmission() {
        const expiration_time = rng.trickle_random(this.node.config.RPL_DAO_RETRANSMISSION_TIMEOUT_SEC);
        if (this.dao_timer) {
            time.remove_timer(this.dao_timer);
        }
        this.dao_timer = time.add_timer(expiration_time, false, this, function(rpl) {
            rpl.resend_dao(); });
    }

    schedule_dao_refresh() {
        if (this.state > DAG_UNUSED) {
            /* DAO-ACK enabled: the last DAO was ACKed, wait until expiration before refresh */
            let target_refresh_sec = this.node.config.RPL_DEFAULT_LIFETIME_MIN * 60;

            /* Send between 60 and 120 seconds before target refresh */
            const safety_margin_sec = rng.uniform(60, 120);

            if (target_refresh_sec > safety_margin_sec) {
                target_refresh_sec -= safety_margin_sec;
            }

            /* Schedule transmission */
            if (this.dao_timer) {
                time.remove_timer(this.dao_timer);
            }
            this.dao_timer = time.add_timer(target_refresh_sec, false, this, function(rpl) {
                rpl.send_new_dao(); });
        }
    }

    rpl_timers_schedule_dao() {
        if (this.state > DAG_UNUSED) {
            mlog(log.DEBUG, this.node, `schedule DAO`);

            /* No need for DAO aggregation delay as per RFC 6550 section 9.5, as this
             * only serves storing mode. Use simple delay instead, with the only purpose
             * to reduce congestion. */
            const expiration_time_sec = rng.trickle_random(this.node.config.RPL_DAO_DELAY_SEC);
            if (this.dao_timer) {
                time.remove_timer(this.dao_timer);
            }
            this.dao_timer = time.add_timer(expiration_time_sec, false, this, function(rpl) {
                rpl.send_new_dao(); });
        }
    }

    send_new_dao() {
        this.dao_timer = null;
        /* We are sending a new DAO here. Prepare retransmissions */
        this.dao_transmissions = 1;
        if (this.node.config.RPL_WITH_DAO_ACK) {
            /* Schedule next retransmission */
            this.schedule_dao_retransmission();
        } else {
            /* No DAO-ACK: assume we are reachable as soon as we send a DAO */
            if (this.state === DAG_JOINED) {
                this.state = DAG_REACHABLE;
            }
            this.rpl_timers_dio_reset();
            /* There is no DAO-ACK, schedule a refresh. */
            this.schedule_dao_refresh();
        }

        /* Increment seqno */
        this.dao_last_seqno = RPL_LOLLIPOP_INCREMENT(this.dao_last_seqno);
        /* Send a DAO with own prefix as target and default lifetime */
        this.dao_output(this.preferred_parent, this.node.config.RPL_DEFAULT_LIFETIME_MIN);
    }

    /*------------------------------- DAO-ACK ---------------------------------- */

    rpl_timers_send_dao_ack(target, sequence) {
        if (this.state > DAG_UNUSED) {
            this.dao_ack_output(target,
                                sequence,
                                RPL_DAO_ACK_UNCONDITIONAL_ACCEPT);

        }
    }

    rpl_timers_notify_dao_ack() {
        /* The last DAO was ACKed. Schedule refresh to avoid route expiration. This
           implicitly de-schedules resend_dao, as both share curr_instance.dag.dao_timer */
        this.schedule_dao_refresh();
    }

    resend_dao() {
        this.dao_timer = null;
        /* Increment transmission counter before sending */
        this.dao_transmissions += 1;
        /* Send a DAO with own prefix as target and default lifetime */
        this.dao_output(this.preferred_parent, this.node.config.RPL_DEFAULT_LIFETIME_MIN);

        /* Schedule next retransmission, or abort */
        if (this.dao_transmissions < this.node.config.RPL_DAO_MAX_RETRANSMISSIONS) {
            this.schedule_dao_retransmission();
        } else {
            /* No more retransmissions. Perform local repair. */
            this.local_repair(false);
        }
    }

    /*------------------------------- Probing----------------------------------- */

    get_probing_delay()  {
        return rng.trickle_random(this.node.config.RPL_PROBING_INTERVAL_SEC);
    }

    get_probing_target() {
        /* Returns the next probing target. The current implementation probes the urgent
         * probing target if any, or the preferred parent if its link statistics need refresh.
         * Otherwise, it picks at random between:
         * (1) selecting the best neighbor with non-fresh link statistics
         * (2) selecting the least recently updated neighbor
         */

        if (this.state === DAG_UNUSED) {
            return null;
        }

        /* There is an urgent probing target */
        if (this.urgent_probing_target) {
            return this.urgent_probing_target;
        }

        /* The preferred parent needs probing */
        if (this.preferred_parent && !this.neighbor_is_fresh(this.preferred_parent)) {
            return this.preferred_parent;
        }

        /* Now consider probing other non-fresh neighbors. With 2/3 proabability,
           pick the best non-fresh. Otherwise, pick the least recently updated non-fresh. */

        let probing_target = null;
        let probing_target_rank = RPL_INFINITE_RANK;
        let probing_target_age = 0;
        let clock_now = time.timeline.seconds;

        if (rng.randint(0, 3) !== 0) {
            /* Look for best non-fresh */
            for (const [_, nbr] of this.rpl_neighbors) {
                if (!this.neighbor_is_fresh(nbr)) {
                    /* nbr needs probing */
                    const nbr_rank = this.of_rank_via_nbr(nbr);
                    if (!probing_target || nbr_rank < probing_target_rank) {
                        probing_target = nbr;
                        probing_target_rank = nbr_rank;
                    }
                }
            }
        } else {
            /* Look for least recently updated non-fresh */
            for (const [_, nbr] of this.rpl_neighbors) {
                if (!this.neighbor_is_fresh(nbr)) {
                    /* nbr needs probing */
                    if (!probing_target
                        || clock_now - nbr.neighbor.last_tx_sec > probing_target_age) {
                        probing_target = nbr;
                        probing_target_age = clock_now - nbr.neighbor.last_tx_sec;
                    }
                }
            }
        }

        return probing_target;
    }

    rpl_schedule_probing() {
        if (this.state > DAG_UNUSED && this.node.config.RPL_WITH_PROBING) {
            if (this.probing_timer) {
                time.remove_timer(this.probing_timer);
            }
            this.probing_timer = time.add_timer(this.get_probing_delay(), false, this, function(rpl) {
                rpl.handle_probing_timer(); });
            mlog(log.DEBUG, this.node, `schedule probing after ${this.probing_timer.interval.toFixed(0)} sec`);
        }
    }

    handle_probing_timer() {
        this.probing_timer = null;
        const probing_target = this.get_probing_target();

        /* Perform probing */
        if (probing_target) {
            mlog(log.DEBUG, this.node, `probing node ${probing_target.neighbor.id}`);
            /* Send probe, e.g. unicast DIO or DIS */
            this.dio_output(probing_target.neighbor.id);
            /* urgent_probing_target will be NULLed in the packet_sent callback */
        } else {
            mlog(log.DEBUG, this.node, "no neighbor needs probing");
        }

        /* Schedule next probing */
        this.rpl_schedule_probing();
    }


    rpl_schedule_probing_now() {
        if (this.probing_timer) {
            time.remove_timer(this.probing_timer);
        }
        this.handle_probing_timer();
    }

    /*------------------------------- Other timers ---------------------------------- */

    rpl_timers_schedule_leaving() {
        if (this.state > DAG_UNUSED) {
            if (!this.leave_timer) {
                this.leave_timer = time.add_timer(this.node.config.RPL_DELAY_BEFORE_LEAVING_SEC, false, this, function(rpl) {
                    rpl.leave_timer = null;
                    if (rpl.state > DAG_UNUSED) {
                        rpl.rpl_dag_leave();
                    }
                });
            }
        }
    }

    rpl_timers_unschedule_leaving() {
        if (this.leave_timer) {
            time.remove_timer(this.leave_timer);
            this.leave_timer = null;
        }
    }

    on_periodic_timer() {
        if (this.state === DAG_UNUSED
            || !this.preferred_parent
            || this.rank === RPL_INFINITE_RANK)  {
            /* Schedule DIS if needed */
            this.rpl_timers_schedule_periodic_dis();
        }

        /* Useful because part of the state update is time-dependent, e.g.,
           the meaning of last_advertised_rank changes with time */
        this.rpl_dag_update_state();
    }

    rpl_timers_stop_dag_timers() {
        /* Stop all timers related to the DAG */
        if (this.leave_timer) {
            time.remove_timer(this.leave_timer);
            this.leave_timer = null;
        }
        if (this.dio_timer) {
            time.remove_timer(this.dio_timer);
            this.dio_timer = null;
        }
        if (this.dao_timer) {
            time.remove_timer(this.dao_timer);
            this.dao_timer = null;
        }
        if (this.probing_timer) {
            time.remove_timer(this.probing_timer);
            this.probing_timer = null;
        }
    }

    /*---------------------------------------------------------------------------*/
    /* RPL packet input and output */

    icmp6_send(destination_id, msg_type, payload, payload_length) {
        /*
         * The packet is sent with is_on_link=true to avoid routing.
         * If the non-storing mode is implemented, exception should be made for DAO packets,
         * as those in the non-storing mode are sent to the root instead of the immediate parent.
         */
        const packet = new pkt.Packet(this.node, destination_id, payload_length, true);
        packet.packet_protocol = constants.PROTO_ICMP6;
        packet.msg_type = msg_type;
        packet.payload = payload;
        this.node.add_packet(packet);
    }

    dio_output(destination_id) {
        mlog(log.INFO, this.node, `DIO output to ${destination_id}`);

        /* Make sure we're up-to-date before sending data out */
        this.rpl_dag_update_state();

        if (this.is_leaf()) {
            /* In leaf mode, we only send DIO messages as unicasts in response to
               unicast DIS messages. */
            if (destination_id === constants.BROADCAST_ID) {
                /* Do not send multicast DIO in leaf mode */
                return;
            }
        }

        this.stats_dio_tx += 1;

        /* DAG Information Object */
        const payload = {};
        payload.version = this.version;
        if (this.is_leaf()) {
            payload.rank = RPL_INFINITE_RANK;
        } else {
            payload.rank = this.rank;
        }
        payload.dtsn = this.dtsn_out;

        this.icmp6_send(destination_id, RPL_CODE_DIO, payload, PKT_LEN_DIO);
    }

    dio_input(packet) {
        this.stats_dio_rx += 1;
        mlog(log.INFO, this.node, `DIO input from ${packet.source.id}`);
        this.rpl_process_dio(packet.source.id, packet);
    }

    dao_output(target, lifetime) {
        mlog(log.INFO, this.node, `DAO output`);

        /* Make sure we're up-to-date before sending data out */
        this.rpl_dag_update_state();

        if (this.state === DAG_UNUSED) {
            mlog(log.WARNING, this.node, "dao_output: not in an instance, skip sending DAO");
            return;
        }

        if (!target) {
            mlog(log.WARNING, this.node, "dao_output: no target, skip sending DAO");
            return;
        }

        this.stats_dao_tx += 1;

        const payload = {};
        payload.prefix = this.node.id;
        payload.lifetime = lifetime * 60;
        payload.sequence = this.dao_last_seqno;
        if (this.node.config.RPL_WITH_DAO_ACK) {
            payload.flags = RPL_DAO_K_FLAG;
        }

        /* Send to the parent (in non-storing mode, would send to the root) */
        this.icmp6_send(target.neighbor.id, RPL_CODE_DAO, payload, PKT_LEN_DAO);
    }

    dao_input(packet) {
        mlog(log.INFO, this.node, `DAO input from ${packet.lasthop_id}`);
        this.stats_dao_rx += 1;

        if (this.state === DAG_UNUSED) {
            mlog(log.WARNING, this.node, "dao_input: not in an instance, ignoring DAO");
            return;
        }

        this.rpl_process_dao(packet);
    }

    dao_ack_output(destination_id, sequence, status) {
        mlog(log.INFO, this.node, `DAO ACK output ${sequence} ${status}`);
        this.stats_dao_ack_tx += 1;

        const payload = {sequence, status};

        this.icmp6_send(destination_id, RPL_CODE_DAO_ACK, payload, PKT_LEN_DAO_ACK);
    }

    dao_ack_input(packet) {
        mlog(log.DEBUG, this.node, `DAO ACK input from ${packet.lasthop_id}`);
        this.stats_dao_ack_rx += 1;

        if (this.state === DAG_UNUSED) {
            mlog(log.WARNING, this.node, "dao_ack_input: not in an instance, ignoring DAO ACK");
            return;
        }

        this.rpl_process_dao_ack(packet.payload.sequence, packet.payload.status);
    }

    dis_output(destination_id) {
        mlog(log.INFO, this.node, `DIS output to ${destination_id}`);
        this.stats_dis_tx += 1;


        /* Make sure we're up-to-date before sending data out */
        this.rpl_dag_update_state();

        this.icmp6_send(destination_id, RPL_CODE_DIS, {}, PKT_LEN_DIS);
    }

    dis_input(packet) {
        this.stats_dis_rx += 1;
        if (this.state === DAG_UNUSED) {
            mlog(log.WARNING, this.node, `dis_input: not in an instance yet, discard`);
            return;
        }

        mlog(log.INFO, this.node, `received a DIS from ${packet.source.id}`);

        this.rpl_process_dis(packet.source.id, packet.destination_id === constants.BROADCAST_ID);
    }

    stats_get() {
        return {
            routing_tx: this.stats_dio_tx + this.stats_dis_tx + this.stats_dao_tx + this.stats_dao_fwd + this.stats_dao_ack_tx,
            routing_rx: this.stats_dio_rx + this.stats_dis_rx + this.stats_dao_rx + this.stats_dao_ack_rx,
            routing_join_time_sec: this.stats_join_time_sec,
            routing_num_parent_changes : this.stats_num_parent_changes
        };
    }
}
