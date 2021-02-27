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
 *         Mobility model in the network simulations
 * \author
 *         Atis Elsts <atis.elsts@edi.lv>
 */

import config from "./config.mjs";
import { get_distance } from './utils.mjs';
import * as log from './log.mjs';
import * as time from './time.mjs';
import { rng } from './random.mjs';

/* A mobility model */
export class MobilityModel {
    constructor(network) {
        this.network = network;
        this.current_period_num = null;
    }

    update_positions() {
        const period_num = Math.trunc(time.timeline.seconds / config.MOBILITY_UPDATE_PERIOD_SEC);
        if (this.current_period_num !== period_num) {
            log.log(log.DEBUG, null, "Mobility", "update positions");
            this.current_period_num = period_num;
            for (const [, node] of this.network.nodes) {
                if (node.config.MOBILITY_MODEL === "Line") {
                    this.update_position_line(node, time.timeline.seconds);
                } else if (node.config.MOBILITY_MODEL === "RandomWaypoint") {
                    this.update_position_rw(node, time.timeline.seconds);
                } else if (node.config.MOBILITY_MODEL !== "Static") {
                    log.log(log.WARNING, node, "Mobility", `unknown mobility model ${node.config.MOBILITY_MODEL}`);
                }
            }
        }
    }

    /* Line mobility model */
    update_position_line(node, seconds) {
        if (!node.hasOwnProperty("start_pos_x")) {
            node.start_pos_x = node.pos_x;
        }

        /* calculate current position */
        let pos_x = node.start_pos_x + node.config.MOBILITY_SPEED * seconds;
        /* bound it relative to the range */
        pos_x %= 2 * node.config.MOBILITY_RANGE_X;
        if (pos_x >= node.config.MOBILITY_RANGE_X) {
            /* go backwards */
            pos_x = 2 * node.config.MOBILITY_RANGE_X - pos_x;
        }
        /* update the node's position */
        node.pos_x = pos_x;
        log.log(log.DEBUG, node, "Mobility", `at ${seconds.toFixed(3)} pos is ${pos_x.toFixed(3)}`);
        this.network.update_node_links(node);
    }

    generate_next_waypoint(node) {
        /* update the last waypoint */
        node.wp_last_x = node.wp_next_x;
        node.wp_last_y = node.wp_next_y;
        node.wp_last_time = node.wp_next_time;
        /* update the next waypoint */
        node.wp_next_x = rng.random() * node.config.MOBILITY_RANGE_X;
        node.wp_next_y = rng.random() * node.config.MOBILITY_RANGE_Y;
        let d = get_distance(node.wp_last_x, node.wp_last_y, node.wp_next_x, node.wp_next_y);
        if (d <= 0) {
            /* Do not allow the distance to be zero */
            d = 0.01;
        }
        node.wp_next_time = d / node.config.MOBILITY_SPEED;
        node.wp_next_time += node.wp_last_time;
    }

    /* Random waypoint mobility model */
    update_position_rw(node, seconds) {
        if (!node.hasOwnProperty("wp_last_x")) {
            /* initialize the node's state - it will contain info about the waypoints and progress */
            node.wp_next_x = node.pos_x;
            node.wp_next_y = node.pos_y;
            node.wp_next_time = seconds;
            this.generate_next_waypoint(node);
        }
        let progress = (seconds - node.wp_last_time) / (node.wp_next_time - node.wp_last_time);
        if (progress > 1.0) {
            /* Avoid jerky motion:
             * if the node had reached the waypoint before this function was called,
             * we assume it sat there still for the time until the call.
             */
            progress = 1.0;
            node.wp_next_time = seconds;
        }
        /* update the node's position */
        node.pos_x = node.wp_last_x + (node.wp_next_x - node.wp_last_x) * progress;
        node.pos_y = node.wp_last_y + (node.wp_next_y - node.wp_last_y) * progress;

        log.log(log.DEBUG, node, "Mobility", `at ${seconds.toFixed(3)} pos is (${node.pos_x.toFixed(3)}, ${node.pos_y.toFixed(3)}) wp=(${node.wp_next_x.toFixed(3)}, ${node.wp_next_y.toFixed(3)})`);

        this.network.update_node_links(node);

        /* time for a new direction? */
        if (progress >= 1.0) {
            this.generate_next_waypoint(node);
        }
    }
}
