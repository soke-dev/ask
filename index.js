/**
 * The app's real entry point.
 *
 * `expo-router/entry` was the entry, which meant the first thing to evaluate
 * was the router — and the router reaches providers, Privy and jose before any
 * file of ours runs. Anything that has to exist before those modules load
 * cannot live inside a route.
 *
 * The import order in this file is the whole point. Do not reorder it.
 */
import './polyfills';
import 'expo-router/entry';
