// This file is a new routing file used to specify static routes
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

export class NewRouting
{
    constructor(node) {
        this.node = node;
    }

    start() {
        log.log(log.INFO, this.node, "Node", `Start method called from Manual Routing for ${this.node.id}`);
        
        // Read the routes.json 
        let route_file_data = null;

        // Read the routes.json file and store in a variable
        try {
            // Specify the path for the routes.json file
            // NOTE: PLEASE CHANGE THIS PATH BASED ON LOCATION OF THE EXAMPLE
            const route_file = "examples/hierarchical/routes.json";
            route_file_data = fs.readFileSync(route_file);    
            if (route_file_data) {
                log.log(log.INFO, this.node, "Node", `Route File Read successfully [ROUTING MANUAL]`);                
            }
        } catch (error) {
            log.log(log.ERROR, this.node, "Node", `Failed to find Route file [ROUTING MANUAL]`);
        }

        // Parse the JSON file into a structure
        try {
            const route_struct = JSON.parse(route_file_data);
            log.log(log.INFO, this.node, "Node", `File loaded into struct successfully [ROUTING MANUAL]`);          
            for (const route of route_struct) {
                // Check if the node_id is the same as the node whose routing is being performed
                if (route.NODE_ID == this.node.id) {
                    log.log(log.INFO, this.node, "Node", `Reading routes for Node ${this.node.id} [ROUTING MANUAL]`);
                    // Call the add_route method from the related node
                    log.log(log.INFO, this.node, "Node", `Destination = ${route.DESTINATION_ID}, Nexthop = ${route.NEXTHOP_ID} [ROUTING MANUAL]`)
                    this.node.add_route(route.DESTINATION_ID, route.NEXTHOP_ID);
                }
            }
        } catch (error) {
            log.log(log.ERROR, this.node, "Node", `Failed to parse data [ROUTING MANUAL]`)
        }
    }

    // tx - transmission, rx - reception, ack - acknowledgement
    on_tx(neighbor, packet, is_ok, is_ack_required) {
        log.log(log.INFO, this.node, "Main", `On tx method called from Manual Routing [ROUTING MANUAL]`);    
    }

    // This method is called once a packet has been generated from the app
    on_prepare_tx_packet(packet) {
        log.log(log.INFO, this.node, "Main", `On prepare tx packet method called from Manual Routing [ROUTING MANUAL]`);      
    }

    on_forward(packet) {
        return true;
    }

    on_new_time_source(old_time_source, new_time_source) {
        log.log(log.INFO, this.node, "Main", `On new time source method called from Manual Routing [ROUTING MANUAL]`);    
    }

    // Local repair called once the Node joins TSCH
    local_repair() {
        log.log(log.INFO, this.node, "Main", `Local repair method called from Manual Routing [ROUTING MANUAL]`);    
    }

    is_joined() {
        return this.node.has_joined;
    }

    on_periodic_timer() {
        log.log(log.INFO, this.node, "Main", `On periodic timer method called from Manual Routing [ROUTING MANUAL]`);           
    }

    stats_get() {
        log.log(log.INFO, this.node, "Main", `Method to get stats called from Manual Routing [ROUTING MANUAL]`);    
        return {
            routing_tx: 0,
            routing_rx: 0,
            routing_join_time_sec: 0,
            routing_num_parent_changes : 1
        };
    }

}
