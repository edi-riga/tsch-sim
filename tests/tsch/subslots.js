
/*
 * Add a packet source that is generating packets is a non-standard subslot.
 */
state.log.log(state.log.INFO, null, "User", `Initializing non-standard slot size`);
state.timeline.slot_timings = [0.01, 0.01, 0.05];

function generate_packet(state) {
    const node = state.network.get_node(2);

    if (node.routing.is_joined()) {
        const packet = new state.pkt.Packet(node, state.constants.ROOT_NODE_ID, state.config.APP_PACKET_SIZE);
        if (this.seqnum === undefined) {
            this.seqnum = 0;
        }
        packet.seqnum = ++this.seqnum;
        /* set the subslot to non-default value */
        packet.subslot = 1;
        node.add_app_packet(packet);
    }
}

const callbacks = {
     5000: generate_packet,
    15000: generate_packet,
    25000: generate_packet,
    35000: generate_packet,
    45000: generate_packet,
    55000: generate_packet,
};

return callbacks;
