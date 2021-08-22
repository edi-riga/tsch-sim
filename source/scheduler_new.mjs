// This file is for adding a new schedule to be used
import { uptime } from 'process';
import config from './config.mjs';
import constants from './constants.mjs';
import * as log from './log.mjs';
import * as time from './time.mjs';
import fs from 'fs';

/* ------------------------------------------------- */

function set_timings()
{
    // Slotframe size
    const sf_size = config.TSCH_SCHEDULE_CONF_DEFAULT_LENGTH ? config.TSCH_SCHEDULE_CONF_DEFAULT_LENGTH : 1;

    // Create an array of timeslots
    let timings_usec = new Array(sf_size);
    /* all slots have the same duration */
    for (let i = 0; i < sf_size; ++i) {
        // Added timeslots duration
        timings_usec[i] = config.MAC_SLOT_DURATION_US;
    }

    // MAC_SLOT_DURATION is in microseconds, convert them to seconds using the map method
    time.timeline.slot_timings = timings_usec.map(x => x / 1000000); /* convert to seconds */
}

function read_schedule(node) {
    
    let schedule_file_data = null;

    try {
        // Specify the path for the schedule.json file
        // NOTE: PLEASE CHANGE THIS PATH BASED ON LOCATION OF THE EXAMPLE
        const schedule_file = "examples/hierarchical/schedule.json";
        schedule_file_data = fs.readFileSync(schedule_file);    
        if (schedule_file_data) {
            log.log(log.INFO, node, "TSCH", `Schedule File Read successfully [SCHEDULER NEW]`);                
        }
    } catch (error) {
        log.log(log.ERROR, node, "TSCH", `Failed to find Schedule file [SCHEDULER NEW]`);
    }

    // Parse the JSON file into a structure
    try {
        const schedule_struct = JSON.parse(schedule_file_data);
        log.log(log.INFO, node, "TSCH", `Schedule File loaded into struct successfully [SCHEDULER NEW]`);          
        return schedule_struct;
    } catch (error) {
        log.log(log.ERROR, node, "TSCH", `Failed to parse data [SCHEDULER NEW]`)
    }
}

/* ------------------------------------------------- */
// Executed when a packet is ready for transmission
export function on_packet_ready(node, packet)
{
    log.log(log.INFO, node, "TSCH", `On packet ready called from new scheduler [SCHEDULER NEW]`);
    const schedule_struct = read_schedule(node);
    let remote_offset = 0;
    let timeslot = 0;
    
    for (const schedule of schedule_struct) {
        if (node.id === schedule.SOURCE && packet.nexthop_id === schedule.DESTINATION) {
            timeslot = schedule.TS;
            remote_offset = schedule.CO;
            // log.log(log.INFO, node, "TSCH", `Schedule: [src: ${schedule.SOURCE}, dest: ${schedule.DESTINATION}, ts: ${schedule.TS}, co: ${schedule.CO}]`);  
        }
    }

    log.log(log.INFO, node, "TSCH", `schedule packet [src: ${packet.source.id}, dest: ${packet.nexthop_id}, seqnum: ${packet.seqnum}], channel offset=${remote_offset} timeslot=${timeslot} [SCHEDULER NEW]`);

    packet.packetbuf.PACKETBUF_ATTR_TSCH_SLOTFRAME = 0;
    packet.packetbuf.PACKETBUF_ATTR_TSCH_TIMESLOT = timeslot;
    packet.packetbuf.PACKETBUF_ATTR_TSCH_CHANNEL_OFFSET = remote_offset;
    return true;
}

/*---------------------------------------------------------------------------*/
export function on_new_time_source(node, old_neighbor, new_neighbor)
{
    log.log(log.INFO, node, "TSCH", `On new time source called from New Scheduler [SCHEDULER NEW]`);
}

export function on_child_added(node, addr)
{
    log.log(log.INFO, node, "TSCH", `On new time source called from New Scheduler [SCHEDULER NEW]`);
}

export function on_child_removed(node, addr)
{
    log.log(log.INFO, node, "TSCH", `On new time source called from New Scheduler [SCHEDULER NEW]`);
}

export function on_tx(node, packet, status_ok)
{
    log.log(log.INFO, node, "TSCH", `On new time source called from New Scheduler [SCHEDULER NEW]`);
}

export function add_root(node, root_id)
{
    log.log(log.INFO, node, "TSCH", `On new time source called from New Scheduler [SCHEDULER NEW]`);
}

export function on_node_becomes_root(node)
{
    log.log(log.INFO, node, "TSCH", `On new time source called from New Scheduler [SCHEDULER NEW]`);
}

/*---------------------------------------------------------------------------*/

/* Initialize a specific node: function required by the scheduling module API */
export function node_init(node)
{
    log.log(log.INFO, node, "TSCH", `*** initializing leaf-and-forwarder scheduler, slotframe_size=${node.config.TSCH_SCHEDULE_CONF_DEFAULT_LENGTH} [SCHEDULER NEW]`);

    /* Add a single slotframe */
    const sf_common = node.add_slotframe(0, "leaf-and-forwarder", node.config.TSCH_SCHEDULE_CONF_DEFAULT_LENGTH);

    /* Add a single cell for EB */ 
    // If the slotframe size is 7, 6 timeslots are used for tranmissions and receptions and one slot is dedicated to EB
    node.add_cell(sf_common,
                  constants.CELL_OPTION_RX | constants.CELL_OPTION_TX | constants.CELL_OPTION_SHARED,
                  constants.CELL_TYPE_ADVERTISING_ONLY,
                  constants.BROADCAST_ID,
                  0, 0);

    const local_offset = 1 + node.addr.u8[node.addr.u8.length - 1] % (config.TSCH_SCHEDULE_CONF_DEFAULT_LENGTH - 1);

    // Add cells at calculated local offset
    log.log(log.INFO, node, "TSCH", `add cells at channel offset=${local_offset} called by node ${node.id} [SCHEDULER NEW]`);

    // i is the timeslot value
    if (node.config.ROUTING_IS_LEAF) {
        node.add_cell(sf_common,
                      constants.CELL_OPTION_RX | constants.CELL_OPTION_TX | constants.CELL_OPTION_SHARED,
                      constants.CELL_TYPE_NORMAL,
                      constants.BROADCAST_ID,
                      local_offset, local_offset);
    } else {
        for (let i = 1; i < config.TSCH_SCHEDULE_CONF_DEFAULT_LENGTH; ++i) {
            node.add_cell(sf_common,
                          constants.CELL_OPTION_TX | constants.CELL_OPTION_RX | constants.CELL_OPTION_SHARED,
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
    log.log(log.INFO, null, "TSCH", `initializing leaf-and-forwarder scheduler [SCHEDULER_NEW]`);

    // Add the length of the slotframe
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
