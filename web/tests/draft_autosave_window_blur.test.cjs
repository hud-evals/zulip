"use strict";

// Tests for draft auto-save functionality when window loses focus.
// This tests that compose drafts are saved when the user switches
// away from the browser window, ensuring no work is lost.

const assert = require("node:assert/strict");

const {mock_esm, set_global, zrequire} = require("./lib/namespace.cjs");
const {run_test, noop} = require("./lib/test.cjs");
const $ = require("./lib/zjquery.cjs");

// Set up required globals
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

// Mock dependencies
const autosize = noop;
autosize.update = noop;
mock_esm("autosize", {default: autosize});

mock_esm("../src/compose_actions", {
    register_compose_cancel_hook: noop,
    register_compose_box_clear_hook: noop,
});
mock_esm("../src/resize", {
    watch_manual_resize: noop,
});
mock_esm("../src/upload", {
    compose_upload_cancel: noop,
});

// Mock drafts module to track update_draft calls
let update_draft_call_count = 0;
let update_draft_return_value;
const drafts = mock_esm("../src/drafts", {
    update_draft() {
        update_draft_call_count += 1;
        return update_draft_return_value;
    },
});

// Mock realm settings for compose_call module
const realm = {
    realm_available_video_chat_providers: {disabled: {id: 0}},
    realm_video_chat_provider: 0,
};
mock_esm("../src/state_data", {
    realm,
    current_user: {},
    set_realm: noop,
    set_current_user: noop,
});

const compose_setup = zrequire("compose_setup");

function reset_state() {
    $.clear_all_elements();
    update_draft_call_count = 0;
    update_draft_return_value = undefined;
}

run_test("window blur triggers draft save after compose_setup initialization", ({override}) => {
    reset_state();

    // Capture the blur handler when it's registered
    let window_blur_handler;
    const $window_stub = {
        on(event, handler) {
            if (event === "blur") {
                window_blur_handler = handler;
            }
        },
    };

    // Override window.to_$ to return our stub that captures the blur handler
    override(window, "to_$", () => $window_stub);

    // Initialize compose_setup - this should register the window blur handler
    compose_setup.initialize();

    // Verify that a blur handler was registered
    assert.ok(window_blur_handler, "Window blur handler should be registered after initialize");

    // Initially, update_draft should not have been called
    assert.equal(update_draft_call_count, 0, "update_draft should not be called before blur event");

    // Simulate window blur event
    window_blur_handler();

    // Verify that update_draft was called when window blur occurred
    assert.equal(update_draft_call_count, 1, "update_draft should be called when window loses focus");
});

run_test("window blur saves draft multiple times", ({override}) => {
    reset_state();
    update_draft_return_value = "draft-id-123";

    let window_blur_handler;
    const $window_stub = {
        on(event, handler) {
            if (event === "blur") {
                window_blur_handler = handler;
            }
        },
    };

    override(window, "to_$", () => $window_stub);

    compose_setup.initialize();

    // Trigger multiple blur events to verify handler works repeatedly
    window_blur_handler();
    assert.equal(update_draft_call_count, 1, "First blur should trigger update_draft");

    window_blur_handler();
    assert.equal(update_draft_call_count, 2, "Second blur should also trigger update_draft");

    window_blur_handler();
    assert.equal(update_draft_call_count, 3, "Third blur should also trigger update_draft");
});

run_test("window blur handler does not error when compose box is empty", ({override}) => {
    reset_state();
    // When compose box is empty, update_draft returns undefined
    update_draft_return_value = undefined;

    let window_blur_handler;
    const $window_stub = {
        on(event, handler) {
            if (event === "blur") {
                window_blur_handler = handler;
            }
        },
    };

    override(window, "to_$", () => $window_stub);

    compose_setup.initialize();

    // This should not throw an error even when update_draft returns undefined
    assert.doesNotThrow(() => {
        window_blur_handler();
    }, "Window blur handler should not throw when compose box is empty");

    assert.equal(update_draft_call_count, 1, "update_draft should still be called even for empty compose");
});
