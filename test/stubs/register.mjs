/**
 * Preload: register the host-module resolve hook. Used as
 * `node --import ./test/stubs/register.mjs <script>`.
 */
import { register } from 'node:module'

register(new URL('./loader.mjs', import.meta.url))
