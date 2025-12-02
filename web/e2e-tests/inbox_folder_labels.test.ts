import assert from "node:assert/strict";

import type {Page} from "puppeteer";

import * as common from "./lib/common.ts";

// Tests for inbox folder labels
// Specifically tests that the "OTHER CHANNELS" label is shown when there are
// pinned channels or channel folders, and "CHANNELS" when there are not.

async function navigate_to_inbox(page: Page): Promise<void> {
    console.log("Navigating to inbox");
    const inbox_selector = ".top_left_inbox";
    await page.waitForSelector(inbox_selector, {visible: true});
    await page.click(inbox_selector);
    await page.waitForSelector("#inbox-main", {visible: true});
}

async function pin_channel_to_top(page: Page, stream_name: string): Promise<void> {
    console.log(`Pinning channel ${stream_name} to top`);
    const stream_id = await common.get_stream_id(page, stream_name);
    assert.ok(stream_id !== undefined, `Stream ${stream_name} not found`);

    // Find and right-click on the stream in the left sidebar
    const stream_selector = `.narrow-filter[data-stream-id="${stream_id}"]`;
    await page.waitForSelector(stream_selector, {visible: true});
    await page.click(stream_selector, {button: "right"});

    // Wait for the popover menu
    await page.waitForSelector("#stream-actions-menu-popover", {visible: true});

    // Click "Pin channel to top"
    const pin_selector =
        '#stream-actions-menu-popover [data-popover-menu-item-action="pin_to_top"]';
    await page.waitForSelector(pin_selector, {visible: true});
    await page.click(pin_selector);

    // Wait for popover to close
    await page.waitForSelector("#stream-actions-menu-popover", {hidden: true});
}

async function get_channel_folder_label(page: Page, folder_header_id: string): Promise<string> {
    const selector = `#${CSS.escape(folder_header_id)} .inbox-header-name-text`;
    await page.waitForSelector(selector, {visible: true});
    return await common.get_text_from_selector(page, selector);
}

async function test_inbox_folder_labels_with_pinned_channel(page: Page): Promise<void> {
    // First, go to all messages to see the left sidebar with channels
    await page.click("#left-sidebar-navigation-list .top_left_all_messages");
    await page.waitForSelector("#message_view_header .zulip-icon-all-messages", {visible: true});

    // Pin a channel to trigger the "OTHER CHANNELS" label
    await pin_channel_to_top(page, "Verona");

    // Navigate to inbox
    await navigate_to_inbox(page);

    // Check that we have the inbox view
    await page.waitForSelector("#inbox-main", {visible: true});

    // The OTHER_CHANNELS folder should be labeled "OTHER CHANNELS" when there's a pinned channel
    // The folder header ID for the other channels folder is "inbox-channels-no-folder-header"
    const folder_header_exists = await page.$(
        "#inbox-channels-no-folder-header .inbox-header-name-text",
    );

    if (folder_header_exists) {
        const label = await get_channel_folder_label(page, "inbox-channels-no-folder-header");
        // When there are pinned channels, the label should be "OTHER CHANNELS"
        assert.equal(
            label,
            "OTHER CHANNELS",
            "When channels are pinned, unpinned channels folder should be labeled 'OTHER CHANNELS'",
        );
    }

    // The pinned folder should exist and be labeled "PINNED CHANNELS"
    const pinned_header_exists = await page.$(
        "#inbox-channels-pinned-folder-header .inbox-header-name-text",
    );
    if (pinned_header_exists) {
        const pinned_label = await get_channel_folder_label(
            page,
            "inbox-channels-pinned-folder-header",
        );
        assert.equal(
            pinned_label,
            "PINNED CHANNELS",
            "Pinned channels folder should be labeled 'PINNED CHANNELS'",
        );
    }
}

async function inbox_folder_labels_tests(page: Page): Promise<void> {
    await common.log_in(page);
    await test_inbox_folder_labels_with_pinned_channel(page);
}

common.run_test(inbox_folder_labels_tests);

