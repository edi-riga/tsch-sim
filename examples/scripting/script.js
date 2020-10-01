/*
 * Simulator script example.
 *
 * The global simulator state is accessible through a `state` variable passed as argument to this script.
 *
 * The state has the following members with mostly self-explanatory names:
 *  - is_running - Boolean flag, if set to true, the simulator will terminate
 *  - network - network structure, keeps track of nodes and links
 *  - timeline - has `seconds` and `asn` member variables
 *  - scheduler - Orchestra or other
 *  - routing - RPL or other
 *  - config - configuration values from config file and the default config
 *  - log - logging module
 */

/* this code is executed once, on startup */
state.log.log(state.log.INFO, null, "User", "---");
state.log.log(state.log.INFO, null, "User", "Hello world from user code!");
state.log.log(state.log.INFO, null, "User", `The network has ${state.network.nodes.size} nodes`);
state.log.log(state.log.INFO, null, "User", "---");

/* The format of callback is: ASN -> function to call at that ASN */
let callbacks = {
    100: function(state) { state.log.log(state.log.INFO, null, "User", "doing things at ASN=100"); },
    200: function(state) { state.log.log(state.log.INFO, null, "User", "doing things at ASN=200"); },
};

/* This function checks the connectivity of the leaf node and disabled  */
function check_connectivity(state) {
    const node_id = 4;

    state.log.log(state.log.INFO, null, "User", `check_connectivity called at ASN=${state.timeline.asn}`);

    /* has the link been disabled already? */
    if (this.is_link_disabled) {
        const node = state.network.get_node(node_id);
        /* has the node re-joined through alternative parent? */
        if (node.routing.is_joined()
            && node.routing.preferred_parent.neighbor.id !== this.first_parent_id) {
            state.log.log(state.log.WARNING, null, "User", `node ${node_id} successfully switched parents (${this.first_parent_id} -> ${node.routing.preferred_parent.neighbor.id})`);
            /* terminate the simulation */
            state.is_running = false;
        }
        return;
    }

    /* get node with ID 4 */
    const node = state.network.get_node(node_id);
    if (!node.routing.is_joined()) {
        state.log.log(state.log.INFO, null, "User", `node ${node_id} not yet joined RPL`);
        return;
    }

    const parent_id = node.routing.preferred_parent.neighbor.id;
    state.log.log(state.log.WARNING, null, "User", `Disabling the link to ${parent_id} for the node ${node_id}`);

    const link_from = state.network.get_link(parent_id, node_id);
    const link_to = state.network.get_link(node_id, parent_id);
    link_from.link_quality = 0;
    link_to.link_quality = 0;
    /* remember variables for the next invocation */
    this.is_link_disabled = true;
    this.first_parent_id = parent_id;
}

/* Check the connectivity periodically, once 500 ASN */
for (let i = 1000; i < state.config.SIMULATION_DURATION_SEC * 100; i += 500) {
    callbacks[i] = check_connectivity;
}

/* Set the callbacks to be executed during the simulation */
return callbacks;
