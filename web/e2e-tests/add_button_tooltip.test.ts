import assert from "node:assert/strict";

import type {Page} from "puppeteer";

import * as common from "./lib/common.ts";

/**
 * Test: Tooltip appears on disabled "Add" button in subscriber/member forms
 *
 * When viewing channel subscriber settings or user group member settings,
 * the "Add" button is disabled until users enter someone to add. When hovering
 * over the disabled button, a tooltip should explain what action is needed.
 */

async function get_tooltip_text(page: Page): Promise<string | null> {
    // Tippy creates a .tippy-box element when the tooltip is shown
    const tooltip = await page.$(".tippy-box .tippy-content");
    if (tooltip === null) {
        return null;
    }
    return common.get_element_text(tooltip);
}

async function test_stream_subscriber_add_button_tooltip(page: Page): Promise<void> {
    console.log("Testing tooltip on disabled Add button in stream subscriber settings");

    // Open the streams modal
    await common.open_streams_modal(page);

    // Click on the "Subscribed" tab to see streams we're subscribed to
    const subscribed_tab_selector = "[data-tab-key='subscribed']";
    await page.waitForSelector(subscribed_tab_selector, {visible: true});
    await page.click(subscribed_tab_selector);

    // Select the first stream (Verona) to open its settings
    const stream_selector = "[data-stream-name='Verona']";
    await page.waitForSelector(stream_selector, {visible: true});
    await page.click(stream_selector);

    // Wait for the stream settings to load and navigate to subscribers
    await page.waitForSelector(".stream_section", {visible: true});

    // Click on the Subscribers tab
    const subscribers_tab_selector = ".settings-sticky-header [data-tab='subscribers']";
    await page.waitForSelector(subscribers_tab_selector, {visible: true});
    await page.click(subscribers_tab_selector);

    // Wait for the add subscribers form to be visible
    await page.waitForSelector(".add_subscribers_container", {visible: true});

    // Find the Add button - it should be disabled initially
    const add_button_selector = ".add-subscriber-button";
    await page.waitForSelector(add_button_selector, {visible: true});

    // Verify the button is disabled
    const is_disabled = await page.$eval(add_button_selector, (el) =>
        el.hasAttribute("disabled"),
    );
    assert.ok(is_disabled, "Add button should be disabled when no subscribers are entered");

    // Hover over the Add button to trigger the tooltip
    await page.hover(add_button_selector);

    // Wait for the tooltip to appear
    await page.waitForSelector(".tippy-box", {visible: true});

    // Check the tooltip text
    const tooltip_text = await get_tooltip_text(page);
    assert.ok(tooltip_text !== null, "Tooltip should appear");
    assert.ok(
        tooltip_text.includes("Enter who should be added"),
        `Tooltip should say "Enter who should be added", got: "${tooltip_text}"`,
    );

    console.log("Stream subscriber Add button tooltip test passed");

    // Close the streams modal
    await page.click("#subscription_overlay .exit-sign");
    await page.waitForSelector("#subscription_overlay", {hidden: true});
}

async function add_button_tooltip_tests(page: Page): Promise<void> {
    await common.log_in(page);
    await test_stream_subscriber_add_button_tooltip(page);
}

common.run_test(add_button_tooltip_tests);

