# Testing against a real Sesame

[日本語](device-testing.ja.md)

Everything in this project is covered by tests, but no part of it has been run
against a lock. This is the procedure for the first run, written so that a step
going differently is something you notice rather than something you work around.

Each step says what to do, what you should see, and what it means if you see
something else. The expected text is quoted exactly as the code produces it.

## What has not been verified

Three things were inferred from published source and specifications rather than
observed. If this procedure fails, these are the likeliest places.

| Step | Inference                                                                                | Read from                                     |
| ---- | ---------------------------------------------------------------------------------------- | --------------------------------------------- |
| 4    | Loading a project whose extension is a `data:` URL offers a "run without sandbox" choice | `scratch-gui`'s `canLoadExtensionFromProject` |
| 5    | The device chooser lists a Sesame when filtered on service `0xFD81`                      | CANDY HOUSE's advertising documentation       |
| 7    | The lock pushes `mech_status` unprompted when it moves                                   | CANDY HOUSE's `81_mechstatus` documentation   |

## Before you start

- **Chrome or Edge**, on desktop or Android. Safari, Firefox, and iOS have no
  Web Bluetooth and cannot do any of this.
- The **sesame app**, signed in, with the lock registered.
- An **owner or manager** key to share. A guest key cannot work: the server
  keeps half of its secret.
- Bluetooth on, and within a few metres of the lock.
- **Do this where being locked out is impossible** — door open, or a lock you
  are holding in your hand. Step 8 moves the physical lock, and this build has
  lock control enabled.
- Close the sesame app before step 5. A lock already connected to a phone may
  not appear in the browser's chooser.

## 1. Open the keyholder

Go to <https://kubohiroya.github.io/turbowarp-sesame/keyholder/>.

**Expect:** the heading `Sesame keyholder`, and the status line reading
`Ready.`

On macOS, Android, or ChromeOS a **Scan QR code with camera** button is shown.
On Windows or Linux it is hidden and a note appears instead, saying to paste the
code's text — Chrome there has no platform barcode support.

**If the status line shows an error instead**, the page could not reach its
storage. Private windows and blocked site data both cause this; use a normal
window.

> This address is for testing only. It shares an origin with every other page
> on `kubohiroya.github.io` and cannot send `frame-ancestors`, so any site may
> embed it. Do not leave a key you care about paired here — see
> [Hosting the keyholder](keyholder-hosting.md).

## 2. Pair a key

In the sesame app, share an **owner or manager** key and display its QR code.

In the keyholder, type a device alias — use `front-door`, which is what the
sample project expects — then click **Scan QR code with camera** and allow the
camera. Hold the phone's screen 10–20 cm from the camera, brightness up, tilted
away from reflections.

**Expect:** a passkey prompt (Touch ID, Windows Hello), then the status line
reading `Paired "front-door" (<the lock's UUID>).` and the device appearing
under **Paired Sesames**.

**If you see `This is a guest key, which does not contain the half of the secret
that Bluetooth needs. Share an owner or manager key instead.`** — the app shared
a guest key. Share a manager key.

**If you see `This is not a sesame sharing QR code.`** — the app displayed a
different kind of code. Read the QR with any QR reader and check whether the
text begins with `ssm://UI?t=sk`. If it does not, note what it does begin with:
that is a format this project does not handle, and it is worth knowing.

**If the passkey prompt does not appear**, the checkbox fell back to a
passphrase. That is fine; enter one and remember it.

**Then reload the page.** The device must still be listed. If it is not,
nothing was stored and the later steps cannot work.

## 3. Check the service worker

Still on the keyholder, open DevTools → **Application**.

**Expect:** under **Service Workers**, one worker, _activated and running_.
Under **Cache Storage**, a cache named `sesame-keyholder-<digest>` holding two
entries.

Now tick **Offline** in the Network panel and reload. **Expect:** the page still
loads. Untick Offline afterwards.

**If the worker is missing**, the page still works; it just needs the network
every time.

## 4. Load the project

Download
<https://kubohiroya.github.io/turbowarp-sesame/turbowarp-sesame-app.sb3>.

Open <https://turbowarp.org> and drag the file onto the page.

**Expect:** a dialog asking whether to load a custom extension, **with a
checkbox offering to run it without the sandbox**. Tick it, then allow.

**This is the inference most worth confirming.** If no such checkbox appears,
stop and note the dialog's exact wording. Without it the extension runs
sandboxed, Web Bluetooth is unavailable, and step 5 cannot succeed.

**Expect after loading:** the stage shows the instructions backdrop, and the
Sesame blocks appear in the palette.

## 5. Connect

Click the green flag. **Expect:** `Press SPACE to connect over Bluetooth.`

Press **SPACE**.

**Expect:** the browser's Bluetooth device chooser opens, listing your Sesame.

**If nothing happens**, drag a `last Sesame error` block into the palette area
and click it. The message says which stage failed:

| Message                                                                                                 | Meaning                          |
| ------------------------------------------------------------------------------------------------------- | -------------------------------- |
| `Bluetooth mode requires reloading this custom extension with "Run extension without sandbox" enabled.` | Step 4's checkbox was not ticked |
| `This browser has no Web Bluetooth…`                                                                    | Wrong browser                    |
| `Keyholder URL must use HTTPS.`                                                                         | The project was edited           |

**If the chooser opens but lists nothing**, the lock is out of range, or a phone
is holding the connection. Close the sesame app and retry.

Choose the device.

**Expect within a few seconds:** `Connected. L locks, U unlocks.`

**If you get an error instead**, it came from `last Sesame error` and names the
stage:

| Message                                                          | Meaning                                      |
| ---------------------------------------------------------------- | -------------------------------------------- |
| `The Sesame did not start a session. Move closer and try again.` | Connected, but no random code arrived        |
| `The Sesame refused to log in to the Sesame (result 9).`         | The paired secret is not this lock's         |
| `The key could not be unlocked…`                                 | Wrong passkey or passphrase in the keyholder |
| `The keyholder did not load.`                                    | The iframe could not be fetched              |

## 6. Read the state

Click a `Sesame status [CHSesame2Status]` block.

**Expect:** `locked` or `unlocked`, matching the lock's actual position.

Try `batteryPercentage` and `batteryVoltage` too, and compare them with what the
sesame app reports. They are computed here from the raw reading, so a large
disagreement means the conversion is wrong.

`wm2State` returns empty. That is correct: it describes a WiFi module, which is
not part of a Bluetooth session.

## 7. Watch it move

Turn the lock **by hand** — the thumbturn, or the app on your phone.

**Expect:** the project says the new state within a second or so, without your
touching it. That is the `when the Sesame state changes` hat running from the
lock's own push.

**If nothing happens**, this model may not push status unprompted. Note it: the
status blocks still work, but the hat block does not.

## 8. Operate the lock

**With the door open.**

Press **U**. **Expect:** the lock physically unlocks.
Press **L**. **Expect:** the lock physically locks.

After each, read `Sesame status [CHSesame2Status]` and confirm it agrees with
what the lock actually did.

## What to report back

If something deviates, these are the details that identify the cause:

- The exact text of any `last Sesame error`.
- For step 4, the dialog's exact wording, and whether a sandbox checkbox
  appeared at all.
- For step 2, if the QR was rejected: what the code's text begins with.
- Browser and version, operating system, and the lock's model.
- Anything in the DevTools console on either page.

## Afterwards

The keyholder at `kubohiroya.github.io` still holds the key you paired. Either
**Forget** it there, or move the keyholder to an origin of its own and pair
again — [Hosting the keyholder](keyholder-hosting.md) covers that.
