# Moving to the Producers Toolbox

The Producers Toolbox replaces the separate Speaker Photo Directory app, the Content Card Studio launcher and the Quote
Pricer page. The Toolbox cannot read their data by itself: each kept it in its own app or browser profile. Move it over
once with the steps below, with the old version and the Toolbox both installed.

API keys and tokens never move: the old apps encrypted them for themselves. Enter them again in the Toolbox, which
stores them encrypted on this computer.

## Smoelenboek (was: Speaker Photo Directory)

1. In the old app, switch to Advanced mode and open **Import / Export**.
2. Click **Export to JSON**. Do this for every project you want to keep.
3. In the Toolbox, open **Smoelenboek**, switch to Advanced mode, open **Import / Export** and upload each JSON file.
4. Enter your Google Search API key again under photo search, if you use it.
5. Optional: choose a **Backup folder** (for example inside Google Drive) so the Toolbox keeps backups there.

## Content Card Studio

With a Shared Drive folder:

1. In the old Content Card Studio, open **Shared Drive** and click **Push**.
2. In the Toolbox, open **Content Card Studio**, then **Shared Drive**. Click **Choose folder…** and pick the same folder.
3. Click **Pull**. Your gear database and saved cards load from the folder.

Without a Shared Drive folder, use **Export all** in the old library and **Import JSON** in the Toolbox.

Then enter your Rentman API token again under **Rentman** and click **Test & Connect**.

## Quote Pricer

1. In the old Quote Pricer, click **Backup**. This downloads a JSON file with your price list and quotations.
2. In the Toolbox, open **Quote Pricer**, click **Restore** and choose that file.
