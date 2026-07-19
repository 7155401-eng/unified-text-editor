from playwright.sync_api import sync_playwright

def verify_aria_labels():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        # Navigate to the local file
        page.goto("file:///app/index.html")

        # Wait for the toolbar to load
        page.wait_for_selector('.toolbar')

        # Check blockquote button
        blockquote_btn = page.locator('button[data-cmd="blockquote"]')
        print(f"Blockquote aria-label: {blockquote_btn.get_attribute('aria-label')}")

        # Check zoom reset button
        zoom_reset_btn = page.locator('button#zoom-reset')
        print(f"Zoom reset aria-label: {zoom_reset_btn.get_attribute('aria-label')}")

        # Take a screenshot
        page.screenshot(path="/app/verification.png")

        browser.close()

if __name__ == "__main__":
    verify_aria_labels()
