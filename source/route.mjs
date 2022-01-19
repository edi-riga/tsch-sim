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
 *         Route and the routing table classes
 * \author
 *         Atis Elsts <atis.elsts@edi.lv>
 */

import constants from './constants.mjs';
import * as log from './log.mjs';
import * as simulator from './simulator.mjs';
import { assert } from './utils.mjs';

/*---------------------------------------------------------------------------*/

export const ROUTE_INFINITE_LIFETIME = 0xFFFFFFFF;

/*---------------------------------------------------------------------------*/

export class Route {
    constructor(prefix, nexthop_id) {
        this.prefix = prefix;
        this.nexthop_id = nexthop_id;
        this.lifetime = ROUTE_INFINITE_LIFETIME;
    }

    is_direct() {
        return this.nexthop_id === this.prefix;
    }
}

/*---------------------------------------------------------------------------*/

export class RoutingTable {
    constructor(node) {
        this.node = node;
        this.clear();
    }

    clear() {
        this.routes = new Map();
        this.default_route = null;
    }

    size() {
        return this.routes.size;
    }

    get_route(destination_id) {
        return this.routes.get(destination_id);
    }

    add_route(destination_id, nexthop_id) {
        assert(!this.routes.get(destination_id));
        log.log(log.INFO, this.node, "Node", `add route to ${destination_id} via ${nexthop_id}`);
        let route = new Route(destination_id, nexthop_id);
        this.routes.set(destination_id, route);
        return route;
    }

    remove_route(destination_id) {
        log.log(log.INFO, this.node, "Node", `remove route to ${destination_id}`);
        this.routes.delete(destination_id);
    }

    add_default_route(nexthop_id) {
        if (this.default_route) {
            this.default_route.nexthop_id = nexthop_id;
        } else {
            log.log(log.INFO, this.node, "Node", `add the default route via ${nexthop_id}`);
            this.default_route = new Route(0, nexthop_id);
        }
        return this.default_route;
    }

    remove_default_route() {
        if (this.default_route) {
            log.log(log.INFO, this.node, "Node", `remove the default route`);
            this.default_route = null;
        }
    }

    lookup_route(destination_id) {
        /* if there is a specific route with /128 bit match, return it */
        if (this.routes.has(destination_id)) {
            return this.routes.get(destination_id);
        }
        /* returns null in case the default route is not present */
        return this.default_route;
    }

    get_nexthop(destination_id) {
        if (destination_id === this.node.id) {
            return destination_id;
        }
        if (destination_id === constants.BROADCAST_ID
            || destination_id === constants.EB_ID) {
            return constants.BROADCAST_ID;
        }
        const route = this.lookup_route(destination_id);
        if (!route) {
            log.log(log.WARNING, this.node, "Node", `failed to find a nexthop for=${destination_id}`);
        }
        return route ? route.nexthop_id : null;
    }
}

/*---------------------------------------------------------------------------*/

export function periodic_process(period_seconds)
{
    log.log(log.INFO, null, "Main", `periodic route processing for all nodes`);

    const total_nodes = simulator.get_nodes().size;
    let num_joined_tsch = 0;
    let num_joined_routing = 0;

    for (const [_, node] of simulator.get_nodes()) {
        const to_remove = [];
        for (const [_, route] of node.routes.routes) {
            if (route.lifetime !== ROUTE_INFINITE_LIFETIME) {
                route.lifetime -= period_seconds;
                if (route.lifetime <= 0) {
                    to_remove.push(route);
                }
            }
        }
        if (node.has_joined) {
            num_joined_tsch += 1;
            if (node.routing.is_joined()) {
                num_joined_routing += 1;
            }
        }

        for (const rr of to_remove) {
            node.routes.remove_route(rr.prefix);
        }
    }

    log.log(log.INFO, null, "Main", `joined_routing/joined_tsch/total=${num_joined_routing}/${num_joined_tsch}/${total_nodes}`);

}
