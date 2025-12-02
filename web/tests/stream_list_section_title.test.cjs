"use strict";

// Tests for the "OTHER" section title feature in stream_list_sort.
// When users have organized channels (pinned streams or folders), the normal
// streams section should be labeled "OTHER" instead of "CHANNELS".

const assert = require("node:assert/strict");

const {make_stream} = require("./lib/example_stream.cjs");
const {zrequire} = require("./lib/namespace.cjs");
const {run_test} = require("./lib/test.cjs");

const channel_folders = zrequire("channel_folders");
const stream_data = zrequire("stream_data");
const stream_list_sort = zrequire("stream_list_sort");
const settings_config = zrequire("settings_config");
const {initialize_user_settings} = zrequire("user_settings");

// Start with always filtering out inactive streams.
const user_settings = {
    demote_inactive_streams: settings_config.demote_inactive_streams_values.always.code,
    web_left_sidebar_show_channel_folders: false,
};
initialize_user_settings({user_settings});
stream_list_sort.set_filter_out_inactives();

// Test streams
const pinned_stream = make_stream({
    subscribed: true,
    name: "pinned",
    stream_id: 1,
    pin_to_top: true,
    is_recently_active: true,
});

const normal_stream = make_stream({
    subscribed: true,
    name: "normal",
    stream_id: 2,
    pin_to_top: false,
    is_recently_active: true,
});

const muted_pinned_stream = make_stream({
    subscribed: true,
    name: "muted pinned",
    stream_id: 3,
    pin_to_top: true,
    is_recently_active: true,
    is_muted: true,
});

const stream_in_folder = make_stream({
    subscribed: true,
    name: "in folder",
    stream_id: 4,
    pin_to_top: false,
    is_recently_active: true,
    folder_id: 1,
});

const another_normal_stream = make_stream({
    subscribed: true,
    name: "another normal",
    stream_id: 5,
    pin_to_top: false,
    is_recently_active: true,
});

function sort_groups(query = "") {
    const streams = stream_data.subscribed_stream_ids();
    return stream_list_sort.sort_groups(streams, query);
}

function get_normal_section_title() {
    const sorted = sort_groups("");
    const normal_section = sorted.sections.find((s) => s.id === "normal-streams");
    return normal_section.section_title;
}

function test(label, f) {
    run_test(label, (helpers) => {
        stream_data.clear_subscriptions();
        // Reset channel folders setting
        helpers.override(user_settings, "web_left_sidebar_show_channel_folders", false);
        f(helpers);
    });
}

// Baseline test: no pinned streams, no folders -> section_title = "CHANNELS"
test("normal_section_title_without_pins_or_folders", () => {
    stream_data.add_sub(normal_stream);
    stream_data.add_sub(another_normal_stream);

    const title = get_normal_section_title();
    assert.equal(title, "translated: CHANNELS");
});

// Test: has pinned streams -> section_title = "OTHER"
test("normal_section_title_with_pinned_streams", () => {
    stream_data.add_sub(pinned_stream);
    stream_data.add_sub(normal_stream);

    const title = get_normal_section_title();
    assert.equal(title, "translated: OTHER");
});

// Test: has muted pinned streams -> section_title = "OTHER"
test("normal_section_title_with_muted_pinned_streams", () => {
    stream_data.add_sub(muted_pinned_stream);
    stream_data.add_sub(normal_stream);

    const title = get_normal_section_title();
    assert.equal(title, "translated: OTHER");
});

// Test: has folder sections -> section_title = "OTHER"
test("normal_section_title_with_folder_sections", ({override}) => {
    // Enable channel folders
    override(user_settings, "web_left_sidebar_show_channel_folders", true);

    // Initialize channel folders
    const test_folder = {
        name: "Test Folder",
        description: "",
        rendered_description: "",
        creator_id: null,
        date_created: 1596710000,
        id: 1,
        is_archived: false,
        order: 0,
    };
    channel_folders.initialize({channel_folders: [test_folder]});

    stream_data.add_sub(stream_in_folder);
    stream_data.add_sub(normal_stream);

    const title = get_normal_section_title();
    assert.equal(title, "translated: OTHER");
});

// Test: combined - pinned streams AND folder sections -> section_title = "OTHER"
test("normal_section_title_with_pinned_and_folders", ({override}) => {
    // Enable channel folders
    override(user_settings, "web_left_sidebar_show_channel_folders", true);

    // Initialize channel folders
    const test_folder = {
        name: "Test Folder",
        description: "",
        rendered_description: "",
        creator_id: null,
        date_created: 1596710000,
        id: 1,
        is_archived: false,
        order: 0,
    };
    channel_folders.initialize({channel_folders: [test_folder]});

    stream_data.add_sub(pinned_stream);
    stream_data.add_sub(stream_in_folder);
    stream_data.add_sub(normal_stream);

    const title = get_normal_section_title();
    assert.equal(title, "translated: OTHER");
});

// Test: only pinned streams (no normal streams) -> section_title = "OTHER"
// Even if normal section is empty, it should still be labeled "OTHER"
test("normal_section_title_with_only_pinned_no_normal", () => {
    stream_data.add_sub(pinned_stream);

    const title = get_normal_section_title();
    assert.equal(title, "translated: OTHER");
});

// Test: empty state (no streams at all) -> section_title = "CHANNELS"
test("normal_section_title_no_streams", () => {
    const title = get_normal_section_title();
    assert.equal(title, "translated: CHANNELS");
});

