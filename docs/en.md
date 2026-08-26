# RichiDrama

RichiDrama is a self-hosted AI short-drama production platform for RichBest Media.

It manages projects, scripts, assets, storyboards, generated media, accounts, and billing.

This repository started as a fork of `xuanyustudio/LocalMiniDrama`.
The current product contains major workflow, account, billing, storage, and UI changes.
The repository keeps the MIT license and upstream attribution.

## Main functions

- Project and episode management
- Character, scene, prop, and shared asset management
- List and canvas storyboard workflows
- Text, image, and video model integrations
- Video, voice, subtitle, and final-film processing
- Account, access, price, and billing management
- Docker-based self-hosted deployment

## Development

Use Node.js 18 or a newer version.

```bash
git clone https://github.com/Moemu/RichiDrama.git
cd RichiDrama
```

Start the backend:

```bash
cd backend-node
npm install
npm run dev
```

Start the frontend in a second terminal:

```bash
cd frontweb
npm install
npm run dev
```

Open `http://127.0.0.1:3013/`.

For production, use Docker Compose:

```bash
docker compose up -d --build
```

## Documentation

- [Documentation index](README.md)
- [Quick start](guides/quickstart.md)
- [AI configuration](guides/configuration.md)
- [Deployment](deployment/README.md)
- [Architecture](architecture/README.md)

## Compatibility

The rename does not migrate production resources.
Legacy deployment paths, container names, storage prefixes, and internal browser identifiers remain unchanged.
This prevents data loss and deployment interruption.

## Links

- [Production service](http://drama.richbest.cn/)
- [GitHub repository](https://github.com/Moemu/RichiDrama)
- [Issues](https://github.com/Moemu/RichiDrama/issues)

## License

[MIT](../LICENSE)
