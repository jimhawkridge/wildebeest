import { component$, Slot } from '@builder.io/qwik'

export default component$(() => {
	return (
		<header class="bg-wildebeest-900 sticky top-[3.9rem] xl:top-0 xl:pt-[10px] z-10">
			<Slot />
		</header>
	)
})
