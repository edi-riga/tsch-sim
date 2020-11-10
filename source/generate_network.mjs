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
 *         Network generator: generates networks with different topologies.
 *         Supported topologies: star, line, grid, mesh (with configurable density).
 *         Only the logistic-loss link model is supported.
 * \author
 *         Atis Elsts <atis.elsts@edi.lv>
 */

import config from './config.mjs';
import * as log from './log.mjs';
import { get_node_distance } from './utils.mjs';
import { rng } from './random.mjs';

function get_rssi(n1, n2)
{
    let d = get_node_distance(n1, n2);
    if (d <= 0) {
        /* do not allow the distance to be zero */
        d = 0.01;
    } else if (d >= config.LOGLOSS_TRANSMIT_RANGE_M) {
        /* no chance of reception */
        return config.LOGLOSS_RX_SENSITIVITY_DBM;
    }
    
    const path_loss_dbm = -config.LOGLOSS_RX_SENSITIVITY_DBM
          + 10 * config.LOGLOSS_PATH_LOSS_EXPONENT * Math.log10(d / config.LOGLOSS_TRANSMIT_RANGE_M);
    return config.TX_POWER_DBM - path_loss_dbm;
}

/* inverse of `get_rssi` */
function distance_from_rssi(rssi)
{
    if (rssi <= config.LOGLOSS_RX_SENSITIVITY_DBM) {
        return config.LOGLOSS_TRANSMIT_RANGE_M;
    }
    const path_loss_dbm = rssi + config.TX_POWER_DBM;
    const noise_to_signal = config.LOGLOSS_RX_SENSITIVITY_DBM - path_loss_dbm;
    const relative_distance = Math.pow(10, noise_to_signal / (10 * config.LOGLOSS_PATH_LOSS_EXPONENT));
    /* log.log(log.INFO, null, "Main", `path_loss_dbm=${path_loss_dbm} noise_to_signal=${noise_to_signal} d=${relative_distance * config.LOGLOSS_TRANSMIT_RANGE_M}`); */
    return relative_distance * config.LOGLOSS_TRANSMIT_RANGE_M;
}

function link_quality(n1, n2)
{
    const rssi = get_rssi(n1, n2);
    const x = rssi - config.LOGLOSS_RSSI_INFLECTION_POINT_DBM;
    const success_rate = 1.0 / (1.0 + Math.exp(-x));
    return { success_rate, rssi };
}

/* inverse of `link_quality` */
function distance_from_link_quality(lq)
{
    const logit = Math.log(lq / (1 - lq));
    const rssi = logit + config.LOGLOSS_RSSI_INFLECTION_POINT_DBM;
    /* log.log(log.INFO, null, "Main", `q=${lq} logit=${logit} rssi=${rssi}`); */
    return distance_from_rssi(rssi);
}

function initialize_random(num_nodes, area_radius)
{
    const nodes = [];
    for (let i = 0; i < num_nodes; ++i) {
        const distance = rng.random() * area_radius;
        const angle = rng.random() * Math.PI * 2;
        const pos_x = distance * Math.sin(angle);
        const pos_y = distance * Math.cos(angle);
        nodes.push({pos_x, pos_y, distance, angle});
    }
    return nodes;
}

function get_degrees_links(nodes)
{
    const links = {};
    let num_good_links = 0;
    for (let i = 0; i < nodes.length; ++i) {
        const n1 = nodes[i];
        for (let j = i + 1; j < nodes.length; ++j) {
            const n2 = nodes[j];
            const link = link_quality(n1, n2);
            if (link.success_rate >= config.POSITIONING_LINK_QUALITY) {
                const key = i * nodes.length + j;
                links[key] = link;
                num_good_links++;
            }
        }
    }
    const degrees = 2 * num_good_links / nodes.length;
    return { degrees, links };
}

function increase_degree(nodes, area_radius)
{
    let furthest_distance = nodes[0].distance;
    let furthest_node = 0;
    for (let j = 1; j < nodes.length; ++j) {
        if (nodes[j].distance > furthest_distance) {
            furthest_distance = nodes[j].distance;
            furthest_node = j;
        }
    }
    const angle = nodes[furthest_node].angle;
    const distance = rng.random() * furthest_distance;
    nodes[furthest_node].pos_x = distance * Math.sin(angle);
    nodes[furthest_node].pos_y = distance * Math.cos(angle);
    nodes[furthest_node].distance = distance;
    return area_radius;
}

function decrease_degree(nodes, area_radius)
{
    /* increase the area size */
    area_radius *= 1.1;
    
    let nearest_distance = nodes[0].distance;
    let nearest_node = 0;
    for (let j = 1; j < nodes.length; ++j) {
        if (nodes[j].distance < nearest_distance) {
            nearest_distance = nodes[j].distance;
            nearest_node = j;
        }
    }
    const angle = nodes[nearest_node].angle;
    const distance = nearest_distance + rng.random() * (area_radius - nearest_distance);
    nodes[nearest_node].pos_x = distance * Math.sin(angle);
    nodes[nearest_node].pos_y = distance * Math.cos(angle);
    nodes[nearest_node].distance = distance;
    return area_radius;
}

/*
 * Generate a random mesh network with a simple algorithm:
 * - initialize random positions depending on the number of links expected and on the network size
 * - while not meeting the constraints, keep moving nodes (further apart or closer together)
 */
function generate_mesh(num_nodes, degrees, area_radius=null)
{
    log.log(log.INFO, null, "Main", `generating a mesh network with ${num_nodes} nodes and ${degrees} degrees`);

    const min_allowed_degrees = 2;
    if (degrees < min_allowed_degrees) {
        log.log(log.ERROR, null, "Main", `impossible to generate a mesh network with ${num_nodes} nodes and ${degrees} degrees: the network would be disconnected`);
        return null;
    }

    /* a node can have links up to N-1 other nodes */
    const max_possible_degrees = num_nodes - 1;
    if (degrees > max_possible_degrees) {
        log.log(log.ERROR, null, "Main", `impossible to generate a network with ${num_nodes} nodes and ${degrees} degrees: too many connections required`);
        return null;
    }

    /* relax the constraint a bit and accept values close to the required */
    const min_acceptable_degrees = Math.min(degrees - 0.5, degrees * 0.95);
    const max_acceptable_degrees = Math.max(degrees + 0.5, degrees * 1.05);

    if (!area_radius) {
        area_radius = Math.trunc(config.LOGLOSS_TRANSMIT_RANGE_M * Math.sqrt(num_nodes) * 4 / degrees);
    }

    const nodes = initialize_random(num_nodes, area_radius);
    let net = get_degrees_links(nodes);
    while (!(min_acceptable_degrees <= net.degrees && net.degrees <= max_acceptable_degrees)) {
        if (net.degrees < min_acceptable_degrees) {
            area_radius = increase_degree(nodes, area_radius);
        } else {
            area_radius = decrease_degree(nodes, area_radius);
        }
        net = get_degrees_links(nodes);
    }

    return nodes;
}

function generate_star(num_nodes)
{
    log.log(log.INFO, null, "Main", `generating a star network with ${num_nodes} nodes`);

    const nodes = [];
    if (!num_nodes) {
        return nodes;
    }
    const radius = distance_from_link_quality(config.POSITIONING_LINK_QUALITY);
    nodes.push({pos_x: radius, pos_y: radius});
    for (let i = 1; i < num_nodes; ++i) {
        const angle = Math.PI * 2 * i / (num_nodes - 1);
        const pos_x = radius * (1 + Math.cos(angle));
        const pos_y = radius * (1 + Math.sin(angle));
        nodes.push({pos_x, pos_y});
    }
    return nodes;
}

function generate_line(num_nodes)
{
    log.log(log.INFO, null, "Main", `generating a line network with ${num_nodes} nodes`);

    const nodes = [];
    const step = distance_from_link_quality(config.POSITIONING_LINK_QUALITY);
    for (let i = 0; i < num_nodes; ++i) {
        const pos_x = i * step;
        const pos_y = 0;
        nodes.push({pos_x, pos_y});
    }
    return nodes;
}

function generate_grid(num_nodes)
{
    log.log(log.INFO, null, "Main", `generating a grid network with ${num_nodes} nodes`);

    const nodes = [];
    const step = distance_from_link_quality(config.POSITIONING_LINK_QUALITY);
    const per_row = Math.ceil(Math.sqrt(num_nodes));
    for (let i = 0; i < num_nodes; ++i) {
        const row = Math.trunc(i / per_row);
        const column = i - row * per_row;

        const pos_x = column * step;
        const pos_y = row * step;
        nodes.push({pos_x, pos_y});
    }
    return nodes;
}

export default function generate_network(num_nodes)
{
    let result;

    if (config.POSITIONING_LAYOUT === "Star") {
        result = generate_star(num_nodes);
    } else if (config.POSITIONING_LAYOUT === "Line") {
        result = generate_line(num_nodes);
    } else if (config.POSITIONING_LAYOUT === "Grid") {
        result = generate_grid(num_nodes);
    } else if (config.POSITIONING_LAYOUT === "Mesh") {
        let num_degrees = config.POSITIONING_NUM_DEGREES;
        if (!num_degrees) {
            /* use sqrt(N) as the default number of degrees */
            num_degrees = Math.sqrt(num_nodes);
        }
        let old_random_seed;
        if (config.POSITIONING_RANDOM_SEED != null) {
            /* save the current state of the RNG */
            old_random_seed = rng.randint(0, 1000000);
            rng.seed(config.POSITIONING_RANDOM_SEED);
        }
        result = generate_mesh(num_nodes, num_degrees);
        if (config.POSITIONING_RANDOM_SEED != null) {
            /* restore the RNG seed */
            rng.seed(old_random_seed);
        }
    } else {
        log.log(log.ERROR, null, "Main", `unknown layout ${config.POSITIONING_LAYOUT}, ignoring; select one of: Mesh/Star/Line/Grid`);
        result = null;
    }

    return result;
}
