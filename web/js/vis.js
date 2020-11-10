/* visualization */
TSCH_SIM.vis = function() {

    /* default and constant values for the visual interface */
    const network_width = 5000,
          network_height = 5000;
    const node_width = 28,
          node_height = 12;
    const num_slots_show_transmissions = 10; /* for last 10 slots */

    let zoom_factor = 1.0;
    let selected_node = null;
    let selected_node_offset_x = 0, selected_node_offset_y = 0;
    let is_mouse_down = false;

    let nodes = []; /* nodes displayed in the network view */
    const node_map = {}; /* network nodes keyed by id */
    let links = {}; /* 'source#dst' -> success_rate */
    let transmissions = []; /* arrows */

    /* set the height of the main window */
    let workspace_height = window.innerHeight
        - ($('#cellview').height() + $('#logview').height() + parseInt($(".grid-container").css("margin-top")));
    $(".workspace").css("height", workspace_height + "px");

    function visualize_status(data) {
        const simulator = data.simulator;
        const network = data.network;
        const schedule = data.schedule;
        const log = data.log;

        /* console.log("visualize status"); */

        TSCH_SIM.main.ensure_running_is_displayed(simulator.is_running);

        /* if the simulation is at non-zero state, resetting and/or getting its status is possible */
        if (simulator.asn) {
            $("#button-reset").removeClass("disabled");
            $("#button-results").removeClass("disabled");
        } else {
            $("#button-reset").addClass("disabled");
            $("#button-results").addClass("disabled");
        }

        $("#sim-time").text(TSCH_SIM.utils.format_time(simulator.seconds + 0.000001));

        /* create all nodes and links anew in the visualization */
        recreate_network(network, simulator.asn);

        /* redraw the network */
        redraw_network();

        /* schedule view */
        if ($('#cellview').is(":visible")) {
            let show_mode = 0;
            if ($('span', "#button-show-cell-packets").hasClass("fa-check")) {
                show_mode = 1;
            } else if ($('span', "#button-show-cell-schedule").hasClass("fa-check")) {
                show_mode = 2;
            } else if ($('span', "#button-show-cell-slotframes").hasClass("fa-check")) {
                show_mode = 3;
            } else if ($('span', "#button-show-cell-chofs").hasClass("fa-check")) {
                show_mode = 4;
            } else if ($('span', "#button-show-cell-channels").hasClass("fa-check")) {
                show_mode = 5;
            }

            let num_nodes = schedule.length ? schedule[0].cells.length : 0;
            let s = "<tbody>\n";
            let prev_seconds = schedule.length ? Math.trunc(10 * (schedule[0].seconds + 0.000001)) : -1;
            /* cells */
            for (let i = -1; i < num_nodes; ++i) {
                const node_id = i === -1 ? -1 : network.nodes[i].id;
                s += "<tr>";
                if (node_id === -1) {
                    s += `<td class="node-table">Time</td>`;
                } else {
                    /* add node ID */
                    s += `<td class="node-table">Node ${node_id}</td>`;
                }

                for (let column = 0; column < schedule.length; ++column) {
                    if (node_id === -1) {
                        const seconds = Math.trunc(10 * (schedule[column].seconds + 0.000001));
                        if (prev_seconds !== seconds && prev_seconds !== -1) {
                            s += `<td class="sch_time">${TSCH_SIM.utils.format_time(seconds / 10, 1)}</td>\n`;
                        } else {
                            s += '<td class="sch_time"></td>\n';
                        }
                        prev_seconds = seconds;
                        continue;
                    }

                    const c = schedule[column].cells[i];
                    if (!c) {
                        s += '<td></td>\n';
                        continue;
                    }

                    s += '<td ';

                    let cell_class = "";
                    switch (show_mode) {
                    case 1:
                        /* packets */
                        if (c.flags & constants.FLAG_PACKET_TX) {
                            cell_class = "sch_tx";
                        } else if (c.flags & constants.FLAG_PACKET_RX) {
                            cell_class = "sch_rx";
                        } else if (c.flags & constants.FLAG_PACKET_BADRX) {
                            cell_class = "sch_badrx";
                        }
                        break;

                    case 2:
                        /* schedule */
                        if ((c.flags & constants.FLAG_TX) && (c.flags & constants.FLAG_RX)) {
                            cell_class = "sch_both";
                        } else if (c.flags & constants.FLAG_RX) {
                            if (c.flags & constants.FLAG_PACKET_RX) {
                                /* packet seen on the air */
                                cell_class = "sch_rx";
                            } else if (c.flags & constants.FLAG_PACKET_BADRX) {
                                /* packet seen on the air */
                                cell_class = "sch_badrx";
                            } else if (c.sf != null) {
                                /* no packet seen */
                                cell_class = "sch_norx";
                            } else {
                                /* no packet seen, scanning mode */
                                cell_class = "sch_norx";
                            }
                        } else if (c.flags & constants.FLAG_TX) {
                            cell_class = "sch_tx";
                        } else if (c.flags & constants.FLAG_SKIPPED_TX) {
                            cell_class = "sch_notx";
                        }
                        break;

                    case 3:
                        /* slotframes */
                        if (c.sf != null) {
                            cell_class = `sch_sf${(c.sf % 16)}`;
                        } else if (c.flags & constants.FLAG_RX) {
                            cell_class = `sch_scan`;
                        }
                        break;

                    case 4:
                        /* channel offsets */
                        if (c.co != null) {
                            cell_class = `sch_ch${(c.co % 16)}`;
                        }
                        break;

                    case 5:
                        /* channels */
                        if (c.ch != null) {
                            cell_class = `sch_ch${(c.ch % 16)}`;
                        }
                        break;
                    }
                    if (cell_class) {
                        s += `class="${cell_class} sch" `;
                    }

                    if (c.l && i < network.nodes.length) { /* has a packet? */
                        /* show popover info */
                        let ss = "Node " + node_id;
                        ss += "<br>ASN 0x" + schedule[column].asn.toString(16);
                        const dst = c.to === -1 ? "all" : c.to;
                        ss += `<br>${c.from} -> ${dst}`;
                        ss += `<br>${c.l} bytes`;
                        ss += `<br>Slotframe ${c.sf}`;
                        ss += `<br>Timeslot ${c.ts}`;
                        ss += `<br>Ch. offset ${c.co}`;
                        ss += `<br>Channel ${c.ch}`;
                        if (dst === "all") {
                            ss += `<br>Broadcast`;
                        } else {
                            ss += `<br>Unicast`;
                        }
                        if (c.flags & constants.FLAG_ACK_OK) {
                            ss += ", ACK OK";
                        } else if (c.flags & constants.FLAG_ACK) {
                            ss += ", no ACK";
                        }

                        /* add the popover */
                        s += 'data-container="body" data-toggle="popover" data-placement="left" data-trigger="hover" data-content="' + ss + '" ';

                        /* Add a visible Tx/Rx text */
                        if (c.from === node_id) {
                            s += '>Tx';
                        } else {
                            s += '>Rx';
                        }
                    } else {
                        /* show either a tooltip or nothing */
                        let cell_title = null;
                        if ((c.flags & constants.FLAG_TX) && (c.flags & constants.FLAG_RX)) {
                            cell_title = "Both";
                        } else if (c.flags & constants.FLAG_RX) {
                            if (c.flags & constants.FLAG_PACKET_RX) {
                                /* packet seen on the air */
                                cell_title = "Rx packet";
                            } else if (c.flags & constants.FLAG_PACKET_BADRX) {
                                /* packet seen on the air */
                                cell_title = "Rx failed";
                            } else if (c.sf != null) {
                                /* no packet seen */
                                cell_title = "Idle Rx";
                            } else {
                                /* no packet seen, scanning mode */
                                cell_title = "Channel scan";
                            }
                        } else if (c.flags & constants.FLAG_TX) {
                            cell_title = "Tx packet";
                        } else if (c.flags & constants.FLAG_SKIPPED_TX) {
                            cell_title = "Skipped Tx";
                        }

                        if (cell_title) {
                            if (c.sf != null) {
                                s += `data-toggle="tooltip" title="${cell_title}; sf=${c.sf} ts=${c.ts} co=${c.co}" `;
                            } else {
                                s += `data-toggle="tooltip" title="${cell_title}; co=${c.co}; ch=${c.ch}" `;
                            }
                        }
                        s += '>&nbsp;';
                    }
                    s += '</td>\n';
                }
                if (schedule.length) {
                    /* add node ID */
                    if (node_id === -1) {
                        s += `<td class="node-table">Time</td>`;
                    } else {
                        /* add node ID */
                        s += `<td class="node-table">Node ${node_id}</td>`;
                    }
                }
                s += "</tr>\n";
            }
            s += "</body>\n";
            $("#tablecells").html(s);

            /* we want popovers! */
            $('[data-toggle="popover"]').popover({
                html : true,
                content: function() {
                    return $('#popover_content_wrapper').html();
                }
            });

            if (simulator.is_running) {
                var element = document.getElementById("cellview");
                element.scrollLeft = element.scrollWidth - element.clientWidth;
            }
        }

        /* log view */
        if ($('#logview').is(":visible")) {
            let s = "";
            for (const entry of log) {
                let time = "";
                if (entry.time !== "") {
                    time = TSCH_SIM.utils.format_time(entry.time);
                }
                s += `<tr><td>${time}</td><td>${entry.node}</td><td>${entry.msg}</td></tr>`;
            }

            $("#logview").find("table").find("tbody").html(s);

            if (simulator.is_running) {
                var element = document.getElementById("logview");
                element.scrollTop = element.scrollHeight - element.clientHeight;
            }
        }
    }

    function canvas_mouse_down() {
        const mouse_position = d3.touches(this)[0] || d3.mouse(this);
        const old_selected = selected_node;
        /* console.log(`mouse up at ${mouse_position[0]} ${mouse_position[1]}`); */
        selected_node = null;

        is_mouse_down = true;

        nodes.forEach(function (d) {
            const xmin = d.x - node_width;
            const xmax = d.x + node_width;
            const ymin = d.y - node_height;
            const ymax = d.y + node_height;

            if (mouse_position[0] >= xmin && mouse_position[0] <= xmax
                && mouse_position[1] >= ymin && mouse_position[1] <= ymax) {
                selected_node = d;
                selected_node_offset_x = mouse_position[0] - d.x;
                selected_node_offset_y = mouse_position[1] - d.y;
            }
        });

        if (old_selected !== selected_node) {
            redraw_network();
        }
    }

    function canvas_mouse_up() {
        is_mouse_down = false;
    }

    function canvas_mouse_move() {
        if (!is_mouse_down || !selected_node) {
            return;
        }
        /* move the node around */
        const mouse_position = d3.touches(this)[0] || d3.mouse(this);
        selected_node.x = mouse_position[0] + selected_node_offset_x;
        selected_node.y = mouse_position[1] + selected_node_offset_y;
        /* also update the network data */
        const network_node = node_map[selected_node.id];
        if (network_node) {
            network_node.x = selected_node.x;
            network_node.y = selected_node.y;
        }
        redraw_network();
        /* update positions in the simulator */
        TSCH_SIM.main.update_simulator_positions(nodes);
    }


    function calculate_text_width(str) {
        let sp = document.createElement("span");
        sp.className = "node_label";
        sp.style.position = "absolute";
        sp.style.top = "-1000px";
        sp.innerHTML = (str || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        document.body.appendChild(sp);
        let w = sp.offsetWidth;
        document.body.removeChild(sp);
        return w;
    }

    function calculate_text_start(str) {
        let tw = calculate_text_width(str);
        return Math.floor(-tw / 2);
    }

    const outer = d3.select("#chart")
          .append("svg:svg")
          .attr("xmlns", "http://www.w3.org/2000/svg")
          .attr("version", "1.1")
          .attr("width", network_width)
          .attr("height", network_height)
          .attr("pointer-events", "all")
          .style("cursor","crosshair")
          .style("user-select", "none");

    /* actions on mouse clicks */
    const vis = outer
          .append('svg:g')
          .on("dblclick.zoom", null)
          .append('svg:g')
          .on("mousemove", canvas_mouse_move)
          .on("mousedown", canvas_mouse_down)
          .on("mouseup", canvas_mouse_up);

    const outer_background = vis.append('svg:rect')
          .attr("id", "background_rect")
          .attr('width', network_width)
          .attr('height', network_width)
          .attr('fill', '#f0f0d0');

    const defs = vis.append("defs");

    /* background picture (maybe enable later) */
    /* defs.append("pattern")
        .attr("id","tab_bg_pattern")
        .attr('width', space_width)
        .attr('height', space_height)
        .attr('patternUnits', 'userSpaceOnUse'); */

    /* arrow */
    defs.append("marker")
        .attr("id", "arrow-blue")
        .attr("markerWidth", 10)
        .attr("markerHeight", 10)
        .attr("refX", 0)
        .attr("refY", 3)
        .attr("orient", "auto")
        .attr("markerUnits", "strokeWidth")
        .append("path")
        .attr("d", "M0,0 L0,6 L9,3 z")
        .attr("fill", "#00f");

    /* arrow */
    defs.append("marker")
        .attr("id", "arrow-red")
        .attr("markerWidth", 10)
        .attr("markerHeight", 10)
        .attr("refX", 0)
        .attr("refY", 3)
        .attr("orient", "auto")
        .attr("markerUnits", "strokeWidth")
        .append("path")
        .attr("d", "M0,0 L0,6 L9,3 z")
        .attr("fill", "#f00");

    vis.attr("transform","scale("+zoom_factor+")");

    $("#button-zoom-out").click(function() {
        zoom_factor *= 0.9;
        vis.attr("transform","scale("+zoom_factor+")");
    });

    $("#button-zoom-in").click(function() {
        zoom_factor *= 1.1;
        vis.attr("transform","scale("+zoom_factor+")");
    });

    $("#button-zoom-reset").click(function() {
        zoom_factor = 1.0;
        vis.attr("transform","scale("+zoom_factor+")");
    });

    function update_grid_container_view() {
        workspace_height = window.innerHeight - parseInt($(".grid-container").css("margin-top"));

        let num_panes_visible = 1;
        if (!parseInt(localStorage.getItem("do_hide_schedule"))) {
            num_panes_visible += 1;
            workspace_height -= $('#cellview').height();
        }
        if (!parseInt(localStorage.getItem("do_hide_logs"))) {
            num_panes_visible += 1;
            workspace_height -= $('#logview').height();

            if (parseInt(localStorage.getItem("do_hide_schedule"))) {
                $('#logview').css("grid-row-start", "2").css("grid-row-end", "2");
            } else {
                $('#logview').css("grid-row-start", "3").css("grid-row-end", "3");
            }
        }

        let rows;
        if (num_panes_visible === 1) {
            row = "1fr";
        } else if (num_panes_visible === 2) {
            rows = "0.7fr 0.3fr";
        } else {
            rows = "0.6fr 0.2fr 0.2fr";
        }

        /* do not allow it to become zero or negative */
        workspace_height = Math.max(workspace_height, 10);

        console.log("set workspace height=", workspace_height);
        $('.grid-container').css("grid-template-rows", rows);
        $(".workspace").css("height", workspace_height + "px");

    }

    function get_success_rate(n1, n2) {
        const key = n1.id + "#" + n2.id;
        const link_success_rate = links[key];
        if (link_success_rate != null) {
            return link_success_rate;
        }
    }

    /* function get_transmission(source, dest) {
        for (let i = 0; i < transmission.length; ++i) {
            if (transmission[i].source === source && transmission[i].dest === dest) {
                return i;
            }
        }
        return null;
    } */

    function create_transmission(source, dest, ok) {
        const xvec = dest.x - source.x;
        const yvec = dest.y - source.y;
        const norm = Math.sqrt(xvec * xvec + yvec * yvec);
        let xadj;
        let yadj;
        if (norm == 0) {
            /* if the nodes are in the same position, there is nothing to do */
            xadj = 0;
            yadj = 0;
        } else {
            xadj = xvec / norm;
            yadj = yvec / norm;
        }
        return {
            source: source.id,
            dest: dest.id,
            xs: source.x + xadj * 28,
            ys: source.y + yadj * 28,
            xe: xvec - xadj * 66,
            ye: yvec - yadj * 66,
            ok: ok
        };
    }

    function recreate_network(network, current_asn) {
        let min_x, min_y;
        if (!network.nodes.length) {
            min_x = min_y = 0;
        } else {
            min_x = network.nodes[0].x;
            min_y = network.nodes[0].y;
            for (let i = 1; i < network.nodes.length; ++i) {
                min_x = Math.min(min_x, network.nodes[i].x);
                min_y = Math.min(min_y, network.nodes[i].y);
            }
            min_x -= 50;
            min_y -= 50;
        }
        nodes = [];
        for (let i = 0; i < network.nodes.length; ++i) {
            let node = network.nodes[i];
            node.x -= min_x;
            node.y -= min_y;
            nodes.push(node);
            node_map[node.id] = node;
        }

        links = network.links;

        transmissions = [];
        for (const asn in network.transmissions) {
            if (current_asn - asn > num_slots_show_transmissions) {
                /* too old, ignore */
                continue;
            }
            const transmissions_at_asn = network.transmissions[asn];
            if (!transmissions_at_asn) {
                continue;
            }

            for (const transmission of transmissions_at_asn) {
                const source = node_map[transmission.from];
                if (transmission.to === -1) {
                    /* broadcast */
                    /*for (const node of nodes) {
                        if (node.id === transmission.from) continue;
                        const dest = node_map[node.id];
                        const lnk = create_transmission(source, dest);
                        transmission.push(lnk);
                    }*/
                } else {
                    /* unicast */
                    const dest = node_map[transmission.to];
                    const lnk = create_transmission(source, dest, transmission.ok);
                    transmissions.push(lnk);
                }
            }
        }
    }

    function redraw_network() {
        /* console.log("redraw the network view"); */
        redraw_nodes();
        redraw_transmissions();
    }

    function redraw_nodes() {
        const d3_nodes = vis.selectAll(".nodegroup").data(nodes);
        d3_nodes.exit().remove();

        const nodeEnter = d3_nodes.enter()
              .append("svg:g")
              .attr("class", "nodegroup");

        nodeEnter.each(function(d, i) {
            const node = d3.select(this);
            node.attr("id", d.id)
                .attr("transform", "translate(" + d.x + ", " + d.y + ")")

            node.append("ellipse")
                .attr("class", "node")
                .attr("cx", 0)
                .attr("cy", 0)
                .attr("rx", node_width)
                .attr("ry", node_height);

            const label = "" + d.id;
            node.append("svg:text")
                .attr('x', calculate_text_start(label))
                .attr('y', 6)
                .attr('class', "node_label")
                .text(label);
        });

        d3_nodes.each(function(d, i) {
            const node = d3.select(this);
            node.attr("id", d.id)
                .attr("transform", "translate(" + d.x + ", " + d.y + ")")

            const selected = (selected_node && selected_node.id === d.id) ?
                  " node_selected" : "";
            node.selectAll(".node")
                .attr("class", "node" + selected);

            node.selectAll(".pdr_label").remove();
            /* if has a selected node and this is not the selected node, show PDR (if nonzero) */
            if (selected_node && selected_node.id !== d.id) {
                const success_rate = get_success_rate(selected_node, d);
                if (success_rate > 0.0) {
                    const text = (100 * success_rate).toFixed(2) + " %";
                    node.append('svg:text')
                        .attr('class','pdr_label')
                        .attr('x', 10)
                        .attr('y', -20)
                        .attr('dy', '.35em')
                        .text(text);
                }
            }
        });
    }

    function redraw_transmissions() {
        const d3_transmissions = vis.selectAll(".transmission").data(transmissions);
        d3_transmissions.exit().remove();

        const enter = d3_transmissions.enter()
            .append("svg:g")
            .attr("class", "transmission");

        enter.each(function(d, i) {
            const line = d3.select(this);

            line.attr("transform", "translate(" + d.xs + ", " + d.ys + ")");
            line.append("line")
                .attr("class", "txline")
                .attr("x1", 0)
                .attr("y1", 0)
                .attr("x2", d.xe)
                .attr("y2", d.ye)
                .attr("stroke", d.ok ? "#00f" : "#f00")
                .attr("stroke-width", "1")
                .attr("marker-end", d.ok ? "url(#arrow-blue)" : "url(#arrow-red)");
        });

        d3_transmissions.each(function(d, i) {
            const line = d3.select(this);
            line.attr("transform", "translate(" + d.xs + ", " + d.ys + ")");
            line.selectAll(".txline")
                .attr("x1", 0)
                .attr("y1", 0)
                .attr("x2", d.xe)
                .attr("y2", d.ye);
        });

    }

    /*
    d3.select(window).on("keyup", function() {
        console.log("key pressed: " + d3.event.keyCode);
        switch (d3.event.keyCode) {
        case 45: // Insert
            break;
        case 46: // Delete
            break;
        }
    });
    */

    /* on load */
    update_grid_container_view();

    return {
        update_grid_container_view: update_grid_container_view,
        visualize_status: visualize_status,
    };

}();
