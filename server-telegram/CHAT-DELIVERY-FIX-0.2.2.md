# Chat delivery repair — 25 November 2026

Runtime 0.2.2 pinned to f5f6fa4275df26199a7edbf855adffd662bc64e4. Hostinger deployment 127891046 completed at 17:05 UTC.

Findings: two Ava receipts were imported with their text intact but inline_image=false, which ST 1.19.0's appendMediaToMessage explicitly uses to hide mes_text. Eve's two Telegram receipts remained unimported against an older chat while her selected character chat was newer.

Client now sets inline_image=true for text-plus-image initiations and repairs its own existing affected messages on opening/collecting. Repair verifies local/saved history signatures, changes only the display flag, renders through updateMessageBlock and saves through native ST. No direct whole-chat server writes.

Authenticated /move endpoint transfers only unimported receipts within the same companion, preserves IDs/order/delivery states, pauses the old binding, refuses running attempts/import leases, and requires fresh destination context. Current-chat status explains other-chat bindings; explicit Use this chat instead moves them. Enabling duplicate active bindings is rejected.

Eve's binding and two pending receipts moved successfully to the selected current chat at 17:06 UTC. Opening that chat imports the receipts and captures its current native prompt; no old conversation prompt is reused for new initiations. Existing chats and Telegram messages were not edited.

19 Node tests passed. Chromium browser fixture passed native hide-flag reproduction, restoration of existing text with preserved image URL, new image/text rendering, ordered receipts, duplicate prevention and widths 320/393/709/1440. No paid generation or real test notification was sent.

User step: refresh ST once and open Ava and Eve. This loads the repaired client, restores Ava's text display, imports Eve's queued messages and prepares Eve's new context.
