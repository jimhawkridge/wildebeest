import { component$, useStyles$ } from '@builder.io/qwik'
import { QwikCityProvider, RouterOutlet, ServiceWorkerRegister } from '@builder.io/qwik-city'
import { RouterHead } from './components/router-head/router-head'

import 'modern-normalize/modern-normalize.css'
import globalStyles from './styles.scss?inline'

export default component$(() => {
	useStyles$(globalStyles)

	return (
		<QwikCityProvider>
			<head>
				<meta charSet="utf-8" />
				<link rel="manifest" href="/manifest.json" />
				<script src="https://kit.fontawesome.com/e3d907997f.js" crossorigin="anonymous"></script>
				<RouterHead />
			</head>
			<body lang="en" class="bg-wildebeest-900 text-white min-w-min">
				<RouterOutlet />
				<ServiceWorkerRegister />
			</body>
		</QwikCityProvider>
	)
})
