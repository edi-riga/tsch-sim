TSCH_SIM.main = function() {
    /* run settings */
    let run_speed = parseInt(localStorage.getItem('run_speed')) || constants.RUN_UNLIMITED;

    let default_data = {
        simulator : {is_running: false, asn: 0, seconds: 0},
        network: {
            nodes: [],
            transmissions: []
        },
        schedule: [],
        log: [],
    };
    const initial_refresh_interval = 200;
    const max_refresh_interval = 64 * initial_refresh_interval;
    let refresh_interval = initial_refresh_interval;
    let refresh_timer = null;
    let refresh_last_data = null;

    function set_run_label() {
        const is_running = $('.changeicon', "#button-run").hasClass("fa-pause");
        let label;
        if (is_running) {
            label = "Pause";
        } else if (run_speed === constants.RUN_STEP_NEXT_ACTIVE
                   || run_speed === constants.RUN_STEP_SINGLE) {
            label = "Step";
        } else {
            label = "Run";
        }
        $('.changetext', "#button-run").text(label);
    }

    function ensure_running_is_displayed(is_running) {
        const display_is_running = $('.changeicon', "#button-run").hasClass("fa-pause");
        if (display_is_running != is_running) {
            if (is_running) {
                $('.changeicon', "#button-run").removeClass("fa-play").addClass("fa-pause");
                $("#button-reset").removeClass("disabled");
                $("#button-results").removeClass("disabled");
            } else {
                $('.changeicon', "#button-run").removeClass("fa-pause").addClass("fa-play");
            }
            set_run_label();
        }
    }

    function get_url(path) {
        return String(window.location.href).replace(/(\/|#|\s)+$/g, '') + "/" + path;
    }

    function schedule_refresh() {
        if (refresh_timer && refresh_interval === initial_refresh_interval) {
            /* already scheduled */
            return;
        }
        refresh_interval = initial_refresh_interval;
        clearTimeout(refresh_timer);
        refresh_timer = setTimeout(refresh, refresh_interval);
    }

    function refresh() {
        if (refresh_timer) {
            clearTimeout(refresh_timer);
            refresh_timer = null;
        }

        $.ajax({
            type: "GET",
            url: get_url("status.json"),
            contentType: "application/json",
            dataType: "json",
            success: function(data) {
                /* console.log("got status data"); */
                refresh_last_data = data;
                TSCH_SIM.vis.visualize_status(data);

                if (data.simulator.is_running) {
                    /* reset the refresh interval on success */
                    refresh_interval = initial_refresh_interval;
                    /* add timer for the next refresh */
                    refresh_timer = setTimeout(refresh, refresh_interval);
                } else {
                    refresh_timer = null;
                }
            },
            error: function(data, textStatus, xhr) {
                console.log("error, data=" + JSON.stringify(data));
                TSCH_SIM.notify("Failed to get simulation status", "error");

                refresh_last_data = null;
                TSCH_SIM.vis.visualize_status(default_data);

                /* refresh slower in case of an error */
                refresh_interval = Math.min(refresh_interval * 2, max_refresh_interval);
                refresh_timer = setTimeout(refresh, refresh_interval);

                ensure_running_is_displayed(false);
            }
        });
    }

    function send_run_command() {
        console.log("send run command");

        $.ajax({
            type: "GET",
            url: get_url("cmdrun.json"),
            data: {
                speed: run_speed,
            },
            contentType: "application/json",
            dataType: "json",
            success: function(data) {
                ensure_running_is_displayed(true);
                refresh(); /* start asking for the status from the simulator */
                /* TSCH_SIM.notify("Started the simulator"); */
            },
            error: function (data, textStatus, xhr) {
                TSCH_SIM.notify("Failed to start the simulator", "error");
            }
        });
    }


    $("#button-run").click(function() {
        if ($('.changeicon', this).hasClass("fa-play")) {
            send_run_command();
        } else {
            $.ajax({
                type: "GET",
                url: get_url("cmdpause.json"),
                contentType: "application/json",
                dataType: "json",
                success: function(data) {
                    ensure_running_is_displayed(false);
                    /* TSCH_SIM.notify("Paused the simulator"); */
                },
                error: function (data, textStatus, xhr) {
                    TSCH_SIM.notify("Failed to pause the simulator", "error");
                }
            });
        }        
    });

    $("#button-reset").click(function() {
        console.log("reset clicked");
        $.ajax({
            type: "GET",
            url: get_url("cmdreset.json"),
            contentType: "application/json",
            dataType: "json",
            success: function(data) {
                TSCH_SIM.notify("Reset the simulator");
                schedule_refresh();
            },
            error: function (data, textStatus, xhr) {
                TSCH_SIM.notify("Failed to reset the simulator", "error");
                schedule_refresh();
            }
        });
    });

    const run_actions = {
        "button-run-unlimited": constants.RUN_UNLIMITED,
        "button-run-1000": constants.RUN_1000_PERCENT,
        "button-run-100": constants.RUN_100_PERCENT,
        "button-run-10": constants.RUN_10_PERCENT,
        "button-run-step-active": constants.RUN_STEP_NEXT_ACTIVE,
        "button-run-step": constants.RUN_STEP_SINGLE,
    };

    function select_run_speed() {
        run_speed = constants.RUN_UNLIMITED;

        const button_id = $(this).attr("id");
        for (let action in run_actions) {
            if (action === button_id) {
                run_speed = run_actions[action];
                $('span', "#" + action).addClass("fa-check");
            } else {
                $('span', "#" + action).removeClass("fa-check");
            }
        }

        localStorage.setItem('run_speed', run_speed);

        set_run_label();

        const is_running = $('.changeicon', "#button-run").hasClass("fa-pause");
        if (is_running) {
            /* issue run command again to update the speed of the sim */
            send_run_command();
        }
    }

    function restore_run_speed() {
        for (let action in run_actions) {
            if (run_speed === run_actions[action]) {
                $('span', "#" + action).addClass("fa-check");
            } else {
                $('span', "#" + action).removeClass("fa-check");
            }
        }
        set_run_label();
    }

    $("#button-run-unlimited").click(select_run_speed);
    $("#button-run-1000").click(select_run_speed);
    $("#button-run-100").click(select_run_speed);
    $("#button-run-10").click(select_run_speed);
    $("#button-run-step-active").click(select_run_speed);
    $("#button-run-step").click(select_run_speed);

    function update_pane_views(is_from_init=false) {
        const do_hide_logs = $("#button-show-logs").hasClass("selected") ? 0 : 1;
        const do_hide_schedule = $("#button-show-schedule").hasClass("selected") ? 0 : 1;

        localStorage.setItem("do_hide_logs", do_hide_logs);
        localStorage.setItem("do_hide_schedule", do_hide_schedule);

        if (do_hide_schedule) {
            $('span', "#button-show-schedule").hide();
            $('#cellview').hide();
        } else {
            $('span', "#button-show-schedule").show();
            $('#cellview').show();
        }

        if (do_hide_logs) {
            $('span', "#button-show-logs").hide();
            $('#logview').hide();
        } else {
            $('span', "#button-show-logs").show();
            $('#logview').show();
        }

        if (!is_from_init) {
            TSCH_SIM.vis.update_grid_container_view();
        }
    }

    $("#button-show-schedule").click(function() {
        $("#button-show-schedule").toggleClass("selected");
        update_pane_views();
        TSCH_SIM.vis.visualize_status(refresh_last_data ? refresh_last_data : default_data);
    });

    $("#button-show-logs").click(function() {
        $("#button-show-logs").toggleClass("selected");
        update_pane_views();
        TSCH_SIM.vis.visualize_status(refresh_last_data ? refresh_last_data : default_data);
    });

    function restore_pane_views() {
        const do_hide_schedule = parseInt(localStorage.getItem("do_hide_schedule")) || 0;
        const do_hide_logs = parseInt(localStorage.getItem("do_hide_logs")) || 0;

        if (do_hide_schedule) {
            $("#button-show-schedule").removeClass("selected");
        } else {
            $("#button-show-schedule").addClass("selected");
        }
        if (do_hide_logs) {
            $("#button-show-logs").removeClass("selected");
        } else {
            $("#button-show-logs").addClass("selected");
        }
        update_pane_views(true);
    }

    const cell_view_buttons = [
        "button-show-cell-schedule",
        "button-show-cell-packets",
        "button-show-cell-slotframes",
        "button-show-cell-chofs",
        "button-show-cell-channels",
    ];

    function restore_cell_view_settings() {
        const selected_button = localStorage.getItem('cell_view_button') || "button-show-cell-schedule";

        for (let button of cell_view_buttons) {
            if (selected_button === button) {
                $('span', "#" + button).addClass("fa-check");
            } else {
                $('span', "#" + button).removeClass("fa-check");
            }
        }
    }

    function update_cell_view_settings() {
        const button_id = $(this).attr("id");
        for (let button of cell_view_buttons) {
            if (button_id === button) {
                $('span', "#" + button).addClass("fa-check");
            } else {
                $('span', "#" + button).removeClass("fa-check");
            }
        }
        localStorage.setItem('cell_view_button', button_id);
        TSCH_SIM.vis.visualize_status(refresh_last_data ? refresh_last_data : default_data);
    }

    $("#button-show-cell-packets").click(update_cell_view_settings);
    $("#button-show-cell-schedule").click(update_cell_view_settings);
    $("#button-show-cell-slotframes").click(update_cell_view_settings);
    $("#button-show-cell-chofs").click(update_cell_view_settings);
    $("#button-show-cell-channels").click(update_cell_view_settings);

    $("#dialog-settings").dialog({
        title: "Settings",
        modal: true,
        autoOpen: false,
        width: "80%",
        open: function() {
            /* load from local cookies? */
            autogenerated_network_display_link_quality();
        },
        close: function() {
            /* save to local cookies? */
        },
    });

    $("#button-apply-settings").click(function() {
        let settings = $( "#input-settings" ).val();
        /* strip starting and ending spaces from the settings */
        settings = String(settings).replace(/^\s+|\s+$/g, '');
        if (!settings) {
            /* allow empty input */
            settings = "{}";
        }
        console.log("apply settings='" + settings + "'");
        let settings_obj;
        try {
            settings_obj = JSON.parse(settings);
        } catch (x) {
            TSCH_SIM.notify("The configuration must either be empty or a valid JSON", "error");
            return;
        }
        if (!autogenerated_network_extend_settings(settings_obj)) {
            return;
        }
        $.ajax({
            type: "POST",
            url: get_url("config.json"),
            contentType: "application/json",
            dataType: "json",
            data: JSON.stringify(settings_obj),
            success: function(data) {
                TSCH_SIM.notify("Settings applied successfully");
                schedule_refresh();
                $( "#dialog-settings" ).dialog("close");
            },
            error: function(data, textStatus, xhr) {
                console.log("error, data=" + JSON.stringify(data));
                TSCH_SIM.notify("Failed to apply settings", "error");
                schedule_refresh();
            }
        });
        $("#dialog-settings").dialog("close");
    });

    $('#button-settings').click(function(){
        if (!$( this ).hasClass('disabled')) {
            $( "#dialog-settings" ).dialog("open");
        }
    });

    function autogenerated_network_display_parameters() {
        if ($('#input-generate-network').is(":checked") && $('#input-network-type-mesh').is(":checked")) {
            $('#input-num-degrees').prop("disabled", false);
            $('.input-autogenerated-mesh').css("color", "black");
        } else {
            $('#input-num-degrees').prop("disabled", true);
            $('.input-autogenerated-mesh').css("color", "grey");
        }
    }

    function autogenerated_network_display_link_quality() {
        const value = $( "#input-link-quality" ).val();
        /* dispaly the value as a number */
        $('#label-link-quality').text(value);
    }

    function autogenerated_network_extend_settings(settings) {
        if ($('#input-generate-network').is(":checked")) {
            /* ignore manually configured positions */
            delete settings["POSITIONS"];
            /* fill in parameters */
            try {
                settings.POSITIONING_NUM_NODES = parseInt($('#input-num-nodes').val());
                if (!Number.isInteger(settings.POSITIONING_NUM_NODES) || settings.POSITIONING_NUM_NODES < 1) {
                    TSCH_SIM.notify("Number of nodes must be a positive integer, not " + settings.POSITIONING_NUM_NODES, "error");
                    return false;
                }
            } catch(x) {
                TSCH_SIM.notify("Number of nodes must be a positive integer", "error");
                return false;
            }
            settings.POSITIONING_LAYOUT = $('input[name="input-network-type"]:checked').val();
            if (settings.POSITIONING_LAYOUT !== "Grid"
                && settings.POSITIONING_LAYOUT !== "Mesh"
                && settings.POSITIONING_LAYOUT !== "Line"
                && settings.POSITIONING_LAYOUT !== "Star") {
                TSCH_SIM.notify("Invalid network type", "error");
                return false;
            }
            settings.POSITIONING_LINK_QUALITY = parseFloat($( "#input-link-quality" ).val()) / 100;
            if (isNaN(settings.POSITIONING_LINK_QUALITY) || settings.POSITIONING_LINK_QUALITY < 0.0 || settings.POSITIONING_LINK_QUALITY > 1.0) {
                TSCH_SIM.notify("Link quality must be between 0.0 and 1.0", "error");
                return false;
            }
            if ($('#input-network-type-mesh').is(":checked")) {
                settings.POSITIONING_NUM_DEGREES = parseInt($('#input-num-degrees').val());
                if (settings.POSITIONING_NUM_DEGREES < 2 || settings.POSITIONING_NUM_DEGREES > settings.POSITIONING_NUM_NODES - 1) {
                    TSCH_SIM.notify("Number of degrees must be between 2 and " + (settings.POSITIONING_NUM_NODES - 1), "error");
                    return false;
                }
            }
        }
        return true;
    }


    $('#input-generate-network').click(function(){
        if ($( this ).is(":checked")) {
            $('#input-network-type-star').prop("disabled", false);
            $('#input-network-type-mesh').prop("disabled", false);
            $('#input-network-type-line').prop("disabled", false);
            $('#input-network-type-grid').prop("disabled", false);
            $('#input-num-nodes').prop("disabled", false);
            $('#input-link-quality').prop("disabled", false);
            $('.input-autogenerated').css("color", "black");

        } else {
            $('#input-network-type-star').prop("disabled", true);
            $('#input-network-type-mesh').prop("disabled", true);
            $('#input-network-type-line').prop("disabled", true);
            $('#input-network-type-grid').prop("disabled", true);
            $('#input-num-nodes').prop("disabled", true);
            $('#input-link-quality').prop("disabled", true);
            $('.input-autogenerated').css("color", "grey");
        }
        autogenerated_network_display_parameters();
    });

    $('#input-network-type-star').click(autogenerated_network_display_parameters);
    $('#input-network-type-mesh').click(autogenerated_network_display_parameters);
    $('#input-network-type-line').click(autogenerated_network_display_parameters);
    $('#input-network-type-grid').click(autogenerated_network_display_parameters);

    $('#input-link-quality').on("input change", autogenerated_network_display_link_quality);


    $("#dialog-results").dialog({
        title: "Statistics",
        modal: true,
        autoOpen: false,
        width: "80%",
        height: 600,
        open: function() {
            console.log("open result stats");
        },
        close: function() {
            console.log("close result stats");
        },
    });

    $('#button-results').click(function(){
        $.ajax({
            type: "GET",
            url: get_url("results.json"),
            contentType: "application/json",
            dataType: "json",
            success: function(data) {
                const s = JSON.stringify(data, null, 2).replace(/ /g, "&nbsp;").replace(/\n/g, "<br>\n");
                $( "#output-results").html(s);
                $( "#dialog-results" ).dialog("open");
            },
            error: function(data, textStatus, xhr) {
                console.log("error, data=" + JSON.stringify(data));
                TSCH_SIM.notify("Failed to get simulation results", "error");
            }
        });
    });

    function update_simulator_positions(nodes) {
        const positions = [];
        nodes.forEach(function (d) {
            positions.push({ID: d.id, X: d.x, Y: d.y});
        });

        $.ajax({
            type: "POST",
            url: get_url("positions.json"),
            contentType: "application/json",
            dataType: "json",
            data: JSON.stringify(positions),
            success: function(data) {
                /* console.log("node positions updated"); */
                schedule_refresh();
            },
            error: function(data, textStatus, xhr) {
                console.log("failed to update node positions");
                /* TSCH_SIM.notify("Failed to update node positions", "error"); */
            }
        });
    }


    /* on load, make sure the visual appearance matches the stored settings */
    restore_run_speed();
    restore_cell_view_settings();
    restore_pane_views();

    /* immediately after loading refresh the page */
    refresh();

    return {
        update_simulator_positions: update_simulator_positions,
        ensure_running_is_displayed: ensure_running_is_displayed,
    };

}();
