
function enable_links(state, do_enable)
{
    state.log.log(state.log.INFO, null, "User", `${do_enable? "enable" : "disable"} links`);
    const link_from = state.network.get_link(1, 2);
    const link_to = state.network.get_link(2, 1);

    if (do_enable) {
        link_from.link_quality = 1.0;
        link_to.link_quality = 1.0;
    } else {
        link_from.link_quality = 0.0;
        link_to.link_quality = 0.0;
    }
}

function reset_stats(state, do_enable)
{
    state.log.log(state.log.INFO, null, "User", `reset all stats`);
    for (let [_, node] of state.network.nodes) {
        node.reset_stats();
    }
}

let callbacks = {
     60000: function(state) { enable_links(state, false); },
     70000: function(state) { enable_links(state, true); },
    120000: function(state) { reset_stats(state); }

};


return callbacks;
