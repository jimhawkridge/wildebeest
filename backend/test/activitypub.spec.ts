import { makeDB, isUrlValid } from './utils'
import { addFollowing } from 'wildebeest/backend/src/mastodon/follow'
import { createPerson } from 'wildebeest/backend/src/activitypub/actors'
import { configure, generateVAPIDKeys } from 'wildebeest/backend/src/config'
import * as activityHandler from 'wildebeest/backend/src/activitypub/activities/handle'
import { createPublicNote } from 'wildebeest/backend/src/activitypub/objects/note'
import { addObjectInOutbox } from 'wildebeest/backend/src/activitypub/actors/outbox'
import { strict as assert } from 'node:assert/strict'
import { cacheObject } from 'wildebeest/backend/src/activitypub/objects/'

import * as ap_users from 'wildebeest/functions/ap/users/[id]'
import * as ap_outbox from 'wildebeest/functions/ap/users/[id]/outbox'
import * as ap_outbox_page from 'wildebeest/functions/ap/users/[id]/outbox/page'

const userKEK = 'test_kek5'
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const domain = 'cloudflare.com'

describe('ActivityPub', () => {
	test('fetch non-existant user by id', async () => {
		const db = await makeDB()

		const res = await ap_users.handleRequest(domain, db, 'nonexisting')
		assert.equal(res.status, 404)
	})

	test('fetch user by id', async () => {
		const db = await makeDB()
		const properties = { summary: 'test summary' }
		const pubKey =
			'-----BEGIN PUBLIC KEY-----MIICIjANBgkqhkiG9w0BAQEFAAOCAg8AMIICCgKCAgEApnI8FHJQXqqAdM87YwVseRUqbNLiw8nQ0zHBUyLylzaORhI4LfW4ozguiw8cWYgMbCufXMoITVmdyeTMGbQ3Q1sfQEcEjOZZXEeCCocmnYjK6MFSspjFyNw6GP0a5A/tt1tAcSlgALv8sg1RqMhSE5Kv+6lSblAYXcIzff7T2jh9EASnimaoAAJMaRH37+HqSNrouCxEArcOFhmFETadXsv+bHZMozEFmwYSTugadr4WD3tZd+ONNeimX7XZ3+QinMzFGOW19ioVHyjt3yCDU1cPvZIDR17dyEjByNvx/4N4Zly7puwBn6Ixy/GkIh5BWtL5VOFDJm/S+zcf1G1WsOAXMwKL4Nc5UWKfTB7Wd6voId7vF7nI1QYcOnoyh0GqXWhTPMQrzie4nVnUrBedxW0s/0vRXeR63vTnh5JrTVu06JGiU2pq2kvwqoui5VU6rtdImITybJ8xRkAQ2jo4FbbkS6t49PORIuivxjS9wPl7vWYazZtDVa5g/5eL7PnxOG3HsdIJWbGEh1CsG83TU9burHIepxXuQ+JqaSiKdCVc8CUiO++acUqKp7lmbYR9E/wRmvxXDFkxCZzA0UL2mRoLLLOe4aHvRSTsqiHC5Wwxyew5bb+eseJz3wovid9ZSt/tfeMAkCDmaCxEK+LGEbJ9Ik8ihis8Esm21N0A54sCAwEAAQ==-----END PUBLIC KEY-----'
		await db
			.prepare('INSERT INTO actors (id, email, type, properties, pubkey) VALUES (?, ?, ?, ?, ?)')
			.bind(`https://${domain}/ap/users/sven`, 'sven@cloudflare.com', 'Person', JSON.stringify(properties), pubKey)
			.run()

		const res = await ap_users.handleRequest(domain, db, 'sven')
		assert.equal(res.status, 200)

		const data = await res.json<any>()
		assert.equal(data.summary, 'test summary')
		assert(data.discoverable)
		assert(data['@context'])
		assert(isUrlValid(data.id))
		assert(isUrlValid(data.url))
		assert(isUrlValid(data.inbox))
		assert(isUrlValid(data.outbox))
		assert(isUrlValid(data.following))
		assert(isUrlValid(data.followers))
		assert.equal(data.publicKey.publicKeyPem, pubKey)
	})

	describe('Accept', () => {
		beforeEach(() => {
			globalThis.fetch = async (input: RequestInfo) => {
				throw new Error('unexpected request to ' + input)
			}
		})

		test('Accept follow request stores in db', async () => {
			const db = await makeDB()
			const actor = await createPerson(domain, db, userKEK, 'sven@cloudflare.com')
			const actor2 = await createPerson(domain, db, userKEK, 'sven2@cloudflare.com')
			await addFollowing(db, actor, actor2, 'not needed')

			const activity = {
				'@context': 'https://www.w3.org/ns/activitystreams',
				type: 'Accept',
				actor: { id: 'https://' + domain + '/ap/users/sven2' },
				object: {
					type: 'Follow',
					actor: actor.id,
					object: 'https://' + domain + '/ap/users/sven2',
				},
			}

			await activityHandler.handle(domain, activity, db, userKEK)

			const row = await db
				.prepare(`SELECT target_actor_id, state FROM actor_following WHERE actor_id=?`)
				.bind(actor.id.toString())
				.first()
			assert(row)
			assert.equal(row.target_actor_id, 'https://' + domain + '/ap/users/sven2')
			assert.equal(row.state, 'accepted')
		})

		test('Object must be an object', async () => {
			const db = await makeDB()
			await createPerson(domain, db, userKEK, 'sven@cloudflare.com')

			const activity = {
				'@context': 'https://www.w3.org/ns/activitystreams',
				type: 'Accept',
				actor: 'https://example.com/actor',
				object: 'a',
			}

			await assert.rejects(activityHandler.handle(domain, activity, db, userKEK), {
				message: '`activity.object` must be of type object',
			})
		})
	})

	describe('Create', () => {
		test('Object must be an object', async () => {
			const db = await makeDB()
			await createPerson(domain, db, userKEK, 'sven@cloudflare.com')

			const activity = {
				'@context': 'https://www.w3.org/ns/activitystreams',
				type: 'Create',
				actor: 'https://example.com/actor',
				object: 'a',
			}

			await assert.rejects(activityHandler.handle(domain, activity, db, userKEK), {
				message: '`activity.object` must be of type object',
			})
		})
	})

	describe('Update', () => {
		test('Object must be an object', async () => {
			const db = await makeDB()

			const activity = {
				'@context': 'https://www.w3.org/ns/activitystreams',
				type: 'Update',
				actor: 'https://example.com/actor',
				object: 'a',
			}

			await assert.rejects(activityHandler.handle(domain, activity, db, userKEK), {
				message: '`activity.object` must be of type object',
			})
		})

		test('Object must exist', async () => {
			const db = await makeDB()

			const activity = {
				'@context': 'https://www.w3.org/ns/activitystreams',
				type: 'Update',
				actor: 'https://example.com/actor',
				object: {
					id: 'https://example.com/note2',
					type: 'Note',
					content: 'test note',
				},
			}

			await assert.rejects(activityHandler.handle(domain, activity, db, userKEK), {
				message: 'object https://example.com/note2 does not exist',
			})
		})

		test('Object must have the same origin', async () => {
			const db = await makeDB()
			const actor = await createPerson(domain, db, userKEK, 'sven@cloudflare.com')
			const object = {
				id: 'https://example.com/note2',
				type: 'Note',
				content: 'test note',
			}

			const obj = await cacheObject(domain, db, object, actor.id, new URL(object.id), false)
			assert.notEqual(obj, null, 'could not create object')

			const activity = {
				'@context': 'https://www.w3.org/ns/activitystreams',
				type: 'Update',
				actor: 'https://example.com/actor',
				object: object,
			}

			await assert.rejects(activityHandler.handle(domain, activity, db, userKEK), {
				message: 'actorid mismatch when updating object',
			})
		})

		test('Object is updated', async () => {
			const db = await makeDB()
			const actor = await createPerson(domain, db, userKEK, 'sven@cloudflare.com')
			const object = {
				id: 'https://example.com/note2',
				type: 'Note',
				content: 'test note',
			}

			const obj = await cacheObject(domain, db, object, actor.id, new URL(object.id), false)
			assert.notEqual(obj, null, 'could not create object')

			const newObject = {
				id: 'https://example.com/note2',
				type: 'Note',
				content: 'new test note',
			}

			const activity = {
				'@context': 'https://www.w3.org/ns/activitystreams',
				type: 'Update',
				actor: actor.id,
				object: newObject,
			}

			await activityHandler.handle(domain, activity, db, userKEK)

			const updatedObject = await db.prepare('SELECT * FROM objects WHERE original_object_id=?').bind(object.id).first()
			assert(updatedObject)
			assert.equal(JSON.parse(updatedObject.properties).content, newObject.content)
		})
	})

	describe('Outbox', () => {
		test('return outbox', async () => {
			const db = await makeDB()
			const actor = await createPerson(domain, db, userKEK, 'sven@cloudflare.com')

			await addObjectInOutbox(db, actor, await createPublicNote(domain, db, 'my first status', actor))
			await addObjectInOutbox(db, actor, await createPublicNote(domain, db, 'my second status', actor))

			const res = await ap_outbox.handleRequest(domain, db, 'sven', userKEK)
			assert.equal(res.status, 200)

			const data = await res.json<any>()
			assert.equal(data.type, 'OrderedCollection')
			assert.equal(data.totalItems, 2)
		})

		test('return outbox page', async () => {
			const db = await makeDB()
			const actor = await createPerson(domain, db, userKEK, 'sven@cloudflare.com')

			await addObjectInOutbox(db, actor, await createPublicNote(domain, db, 'my first status', actor))
			await sleep(10)
			await addObjectInOutbox(db, actor, await createPublicNote(domain, db, 'my second status', actor))

			const res = await ap_outbox_page.handleRequest(domain, db, 'sven', userKEK)
			assert.equal(res.status, 200)

			const data = await res.json<any>()
			assert.equal(data.type, 'OrderedCollectionPage')
			assert.equal(data.orderedItems.length, 2)
			assert.equal(data.orderedItems[0].object.content, 'my second status')
			assert.equal(data.orderedItems[1].object.content, 'my first status')
		})
	})

	describe('Announce', () => {
		test('Announce objects are stored and added to the remote actors outbox', async () => {
			const remoteActorId = 'https://example.com/actor'
			const objectId = 'https://example.com/some-object'
			globalThis.fetch = async (input: RequestInfo) => {
				if (input.toString() === remoteActorId) {
					return new Response(
						JSON.stringify({
							id: remoteActorId,
							icon: { url: 'img.com' },
							type: 'Person',
						})
					)
				}

				if (input.toString() === objectId) {
					return new Response(
						JSON.stringify({
							id: objectId,
							type: 'Note',
							content: 'foo',
						})
					)
				}

				throw new Error('unexpected request to ' + input)
			}

			const db = await makeDB()
			await configure(db, { title: 'title', description: 'a', email: 'email' })
			await generateVAPIDKeys(db)
			await createPerson(domain, db, userKEK, 'sven@cloudflare.com')

			const activity: any = {
				type: 'Announce',
				actor: remoteActorId,
				to: [],
				cc: [],
				object: objectId,
			}
			await activityHandler.handle(domain, activity, db, userKEK)

			const object = await db.prepare('SELECT * FROM objects').bind(remoteActorId).first()
			assert(object)
			assert.equal(object.type, 'Note')
			assert.equal(object.original_actor_id, remoteActorId)

			const outbox_object = await db
				.prepare('SELECT * FROM outbox_objects WHERE actor_id=?')
				.bind(remoteActorId)
				.first()
			assert(outbox_object)
			assert.equal(outbox_object.actor_id, remoteActorId)
		})
	})

	describe('Objects', () => {
		test('cacheObject deduplicates object', async () => {
			const db = await makeDB()
			const properties = { type: 'Note', a: 1, b: 2 }
			const actor = await createPerson(domain, db, userKEK, 'a@cloudflare.com')
			const originalObjectId = new URL('https://example.com/object1')

			let result: any

			// Cache object once adds it to the database
			const res1: any = await cacheObject(domain, db, properties, actor.id, originalObjectId, false)
			assert.equal(res1.object.a, 1)
			assert.equal(res1.object.b, 2)
			assert(res1.created)

			result = await db.prepare('SELECT count(*) as count from objects').first()
			assert.equal(result.count, 1)

			// Cache object second time updates the first one
			properties.a = 3
			const res2: any = await cacheObject(domain, db, properties, actor.id, originalObjectId, false)
			// The creation date and properties don't change
			assert.equal(res1.object.a, res2.object.a)
			assert.equal(res1.object.b, res2.object.b)
			assert.equal(res1.object.published, res2.object.published)
			assert(!res2.created)

			result = await db.prepare('SELECT count(*) as count from objects').first()
			assert.equal(result.count, 1)
		})
	})
})
