"use strict";

/**
 * Tests for the DM compose recipient button feature.
 *
 * This tests the new "Add recipient" button in the DM compose area that
 * opens the typeahead dropdown when clicked.
 */

const assert = require("node:assert/strict");

const {make_realm} = require("./lib/example_realm.cjs");
const {mock_esm, set_global, zrequire} = require("./lib/namespace.cjs");
const {run_test, noop} = require("./lib/test.cjs");
const $ = require("./lib/zjquery.cjs");

// Mock global objects
set_global("document", {
    querySelector() {},
});
set_global("navigator", {});
set_global(
    "ResizeObserver",
    class ResizeObserver {
        observe() {}
    },
);

// Mock autosize
const autosize = noop;
autosize.update = noop;
mock_esm("autosize", {default: autosize});

// Mock dependencies that compose_setup imports
mock_esm("../src/channel");
mock_esm("../src/compose_actions", {
    register_compose_cancel_hook: noop,
    register_compose_box_clear_hook: noop,
});
mock_esm("../src/compose_fade");
mock_esm("../src/compose_notifications");
mock_esm("../src/compose_pm_pill", {
    initialize: noop,
});
mock_esm("../src/loading");
mock_esm("../src/markdown");
mock_esm("../src/narrow_state");
mock_esm("../src/rendered_markdown");
mock_esm("../src/resize");
mock_esm("../src/sent_messages");
mock_esm("../src/server_events_state");
mock_esm("../src/transmit");
mock_esm("../src/upload", {
    compose_upload_cancel: noop,
    feature_check: noop,
    setup_upload: noop,
});
mock_esm("../src/onboarding_steps", {
    ONE_TIME_NOTICES_TO_DISPLAY: new Set(),
});
mock_esm("../src/settings_data", {
    user_has_permission_for_group_setting: () => true,
});
mock_esm("../src/compose_call", {
    compute_show_video_chat_button: () => false,
    compute_show_audio_chat_button: () => false,
    abort_video_callbacks: noop,
});
mock_esm("../src/compose_call_ui");
mock_esm("../src/flatpickr");
mock_esm("../src/popovers", {
    hide_all: noop,
});

// Track if typeahead lookup was called with correct args
let lookup_called_with_force = false;
let input_focused = false;

// Mock composebox_typeahead with the exported private_message_recipient_typeahead
const composebox_typeahead = mock_esm("../src/composebox_typeahead", {
    private_message_recipient_typeahead: {
        lookup(hideOnEmpty, force_lookup) {
            if (hideOnEmpty === false && force_lookup === true) {
                lookup_called_with_force = true;
            }
        },
    },
});

// Set up state_data
const {set_realm} = zrequire("state_data");
set_realm(make_realm({realm_topics_policy: "allow_empty_topic"}));

const {initialize_user_settings} = zrequire("user_settings");
initialize_user_settings({user_settings: {}});

function reset_test_state() {
    lookup_called_with_force = false;
    input_focused = false;
    $.clear_all_elements();
}

function setup_dom_elements() {
    // Set up required DOM elements that compose_setup.initialize() expects
    $("textarea#compose-textarea");
    $(".compose-control-buttons-container .video_link").toggle = noop;
    $(".compose-control-buttons-container .audio_link").toggle = noop;
    $(".collapse_composebox_button");
    $(".expand_composebox_button");
    $(".maximize_composebox_button");
    $("#compose_buttons");
    $("#compose-send-button");
    $(".message-header-stream-settings-button");
    $(".message-header-group-settings-button");
    $("#compose_recipient_selection_dropdown_wrapper");
    $(".compose_mobile_button");
    $("#compose_close");
    $("input#stream_message_recipient_topic");
    $("#send_later");
    $("form#send_message_form");
    $("#compose-textarea-container");
    $(".file_input");
    $("#compose_limit_indicator_container");
    $("#compose-limit-indicator");
    $("#compose-banners .wildcard_warning");
    $("#compose-banners .automatic_new_visibility_policy");
    $("#compose_banners");
    $(".topic_resolved_warning");
    $(".narrow_to_compose_recipients");
    $(".compose_control_button_container .add-poll");
    $(".compose_control_button_container .add-video-chat");
    $(".compose_control_button_container .add-audio-chat");
    $(".compose_control_button_container .add-new-todo-list");
    $("#compose-content");
    $("ul.compose_submit_control_buttons");
    $(".compose_new_conversation_button");
    $(".compose-send-message-button-container");
    $(".send-button-tooltip-wrapper");
    $(".compose-textarea-send-wrapper");
    $(".can_send_direct_messages_group_based_warning");
    $("#stream_message_recipient_topic");
    $(".recipient_box_clear_topic_button");
    $("input#stream_message_recipient_topic");
    $(".empty-topic-display");
    $(".message-content-container");
    $("#sending-indicator");
    $("textarea#compose-textarea").val = () => "";
    $("input#stream_message_recipient_topic").val = () => "";
    $("input#stream_message_recipient_topic").on = noop;
    $("textarea#compose-textarea").on = noop;
    $("#compose_close").on = noop;
    $(".compose_mobile_button").on = noop;
    $(".collapse_composebox_button").on = noop;
    $(".maximize_composebox_button").on = noop;
    $(".expand_composebox_button").on = noop;
    $("form#send_message_form").on = noop;
    $("#compose-send-button").on = noop;
    $(".message-header-stream-settings-button").on = noop;
    $(".message-header-group-settings-button").on = noop;
    $("#compose_recipient_selection_dropdown_wrapper").on = noop;
    $("ul.compose_submit_control_buttons").on = noop;
    $(".compose_new_conversation_button").on = noop;
    $(".compose-send-message-button-container").on = noop;
    $(".send-button-tooltip-wrapper").on = noop;
    $(".compose-textarea-send-wrapper").on = noop;
    $(".can_send_direct_messages_group_based_warning").on = noop;
    $("#stream_message_recipient_topic").on = noop;
    $(".recipient_box_clear_topic_button").on = noop;
    $(".empty-topic-display").on = noop;
    $(".message-content-container").on = noop;
    $("#compose_banners").on = noop;
    $(".topic_resolved_warning").on = noop;
    $(".narrow_to_compose_recipients").on = noop;
    $(".compose_control_button_container .add-poll").on = noop;
    $(".compose_control_button_container .add-video-chat").on = noop;
    $(".compose_control_button_container .add-audio-chat").on = noop;
    $(".compose_control_button_container .add-new-todo-list").on = noop;
    $("#compose-content").on = noop;
    $("#sending-indicator").hide = noop;
    
    // Set up the DM recipient button and its parent
    const $compose_direct_recipient = $("#compose-direct-recipient");
    const $private_message_recipient = $("#private_message_recipient");
    
    // Mock the focus method to track if input was focused
    $private_message_recipient.trigger = function (event) {
        if (event === "focus") {
            input_focused = true;
        }
        return this;
    };
}

run_test("dm recipient button click triggers typeahead lookup", () => {
    reset_test_state();
    setup_dom_elements();

    // Get the compose_setup module
    const compose_setup = zrequire("compose_setup");

    // Initialize compose_setup which registers all event handlers
    compose_setup.initialize();

    // Get the click handler for the DM recipient button
    // The handler is registered as: $("#compose-direct-recipient").on("click", "#compose-new-direct-recipient-button", ...)
    const click_handler = $("#compose-direct-recipient").get_on_handler(
        "click",
        "#compose-new-direct-recipient-button",
    );

    // Verify the handler exists
    assert.ok(click_handler, "Click handler should be registered for DM recipient button");

    // Create a mock event
    const mock_event = {
        preventDefault() {},
        stopPropagation() {},
    };

    // Trigger the click handler
    click_handler(mock_event);

    // Verify the input was focused
    assert.ok(input_focused, "Private message recipient input should be focused");

    // Verify typeahead lookup was called with force_lookup=true
    assert.ok(
        lookup_called_with_force,
        "Typeahead lookup should be called with force_lookup=true",
    );
});

run_test("dm recipient button click calls preventDefault and stopPropagation", () => {
    reset_test_state();
    setup_dom_elements();

    const compose_setup = zrequire("compose_setup");
    compose_setup.initialize();

    const click_handler = $("#compose-direct-recipient").get_on_handler(
        "click",
        "#compose-new-direct-recipient-button",
    );

    let prevent_default_called = false;
    let stop_propagation_called = false;

    const mock_event = {
        preventDefault() {
            prevent_default_called = true;
        },
        stopPropagation() {
            stop_propagation_called = true;
        },
    };

    click_handler(mock_event);

    assert.ok(prevent_default_called, "preventDefault should be called");
    assert.ok(stop_propagation_called, "stopPropagation should be called");
});

