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
 *         Null routing protocol implementation.
 * \author
 *         Atis Elsts <atis.elsts@edi.lv>
 */

import fs from 'fs';
import process from 'process';
import config from './config.mjs';
import * as log from './log.mjs';

/* Initialize the routing protocol configuration */
export function initialize(network)
{
    const default_config = {
    };

    for (const key in default_config) {
        /* set the ones that have not been set from the config file */
        if (!config.hasOwnProperty(key)) {
            config[key] = default_config[key];
        }
    }
}

/*---------------------------------------------------------------------------*/

export class NullRouting
{
    constructor(node) {
        this.node = node;
    }

    start() {
        log.log(log.INFO, this.node, "Node", `Start method called from NullRouting for ${this.node.id}`);
        
        // Read the routes.json 
        let route_file_data = null;

        // Read the routes.json file and store in a variable
        try {
            // Specify the path for the routes.json file
            // NOTE: PLEASE CHANGE THIS PATH BASED ON LOCATION OF THE EXAMPLE
            const route_file = "examples/hierarchical/routes.json";
            route_file_data = fs.readFileSync(route_file);    
            if (route_file_data) {
                log.log(log.INFO, this.node, "Node", `Route File Read successfully [ROUTING NULL]`);                
            }
        } catch (error) {
            log.log(log.ERROR, this.node, "Node", `Failed to find Route file [ROUTING NULL]`);
        }

        // Parse the JSON file into a structure
        try {
            const route_struct = JSON.parse(route_file_data);
            log.log(log.INFO, this.node, "Node", `File loaded into struct successfully [ROUTING NULL]`);          
            for (const route of route_struct) {
                // Check if the node_id is the same as the node whose routing is being performed
                if (route.NODE_ID == this.node.id) {
                    log.log(log.INFO, this.node, "Node", `Reading routes for Node ${this.node.id} [ROUTING NULL]`);
                    // Call the add_route method from the related node
                    log.log(log.INFO, this.node, "Node", `Destination = ${route.DESTINATION_ID}, Nexthop = ${route.NEXTHOP_ID} [ROUTING NULL]`)
                    this.node.add_route(route.DESTINATION_ID, route.NEXTHOP_ID);
                }
            }
        } catch (error) {
            log.log(log.ERROR, this.node, "Node", `Failed to parse data [ROUTING NULL]`)
        }
    }

    on_tx(neighbor, packet, is_ok, is_ack_required) {
        log.log(log.INFO, this.node, "Main", `On tx method called from NullRouting [ROUTING NULL]`);    
    }

    // This method is called once a packet has been generated from the app
    on_prepare_tx_packet(packet) {
        log.log(log.INFO, this.node, "Main", `On prepare tx packet method called from NullRouting [ROUTING NULL]`);      
    }

    on_forward(packet) {
        return true;
    }

    on_new_time_source(old_time_source, new_time_source) {
        log.log(log.INFO, this.node, "Main", `On new time source method called from NullRouting [ROUTING NULL]`);    
    }

    // Local repair called once the Node joins TSCH
    local_repair() {
        log.log(log.INFO, this.node, "Main", `Local repair method called from NullRouting [ROUTING NULL]`);    
    }

    is_joined() {
        return this.node.has_joined;
    }

    on_periodic_timer() {
        log.log(log.INFO, this.node, "Main", `On periodic timer method called from NullRouting [ROUTING NULL]`);           
    }

    stats_get() {
        log.log(log.INFO, this.node, "Main", `Method to get stats called from NullRouting [ROUTING NULL]`);    
        return {
            routing_tx: 0,
            routing_rx: 0,
            routing_join_time_sec: 0,
            routing_num_parent_changes : 1
        };
    }

}
