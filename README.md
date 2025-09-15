# Google Sheets Backend

## Usage

### Before first usage

- Create a Google Cloud project for the app (https://console.cloud.google.com/projectcreate); everything below is in the context of that project
- Create a client (https://console.cloud.google.com/auth/clients) of type "Web application", and take a note of its ID
- Add http://localhost:8080 (and/or whatever production URL you have) to the list of authorised JavaScript origins and the list of authorized redirect URIs for the client
- Authorize google drive api access for the project (https://console.developers.google.com/apis/api/drive.googleapis.com/)
- (seems to be optional) Enable the Google Drive API for appdata for the project (https://console.cloud.google.com/auth/scopes)
- Add the email of the google account(s) you intend to use for the app to the list of allowed test users (https://console.cloud.google.com/auth/audience)
- Replace the client ID in `googleClientConfig.js` with the one you got from the client creation step

### Sample usage page

To run the sample page, serve `sample-usage-page.html` from a location that's supported by the lists configured for the Google client defined above (e.g. http://localhost:8080/), and then open it in a browser.

The page will allow you to:
- Sign in/out with your Google account
- List files in the Drive appDataFolder
- Enter a file name, read its text content into a textarea, edit it, save (create or overwrite) the file in appDataFolder, and delete it

All operations are restricted to the Drive appDataFolder and rely on the GDriveAppData methods that take the file name as input.
