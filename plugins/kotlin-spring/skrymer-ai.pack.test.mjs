import { test } from 'node:test'
import assert from 'node:assert/strict'
import pack from './skrymer-ai.pack.mjs'

const { targets, survivors } = pack.mutation

/** A pitest `mutations.xml` holding [mutations], each written as pitest writes one. */
const report = (...mutations) => `<?xml version="1.0" encoding="UTF-8"?>
<mutations partial="true">
${mutations.join('\n')}
</mutations>
`

const mutation = ({ detected = 'false', status = 'SURVIVED', sourceFile = 'Order.kt', mutatedClass = 'acme.shop.Order', line = 12, mutator = 'org.pitest.mutationtest.engine.gregor.mutators.ConditionalsBoundaryMutator', description = 'changed conditional boundary', quote = "'" }) =>
  `<mutation detected=${quote}${detected}${quote} status=${quote}${status}${quote} numberOfTestsRun=${quote}1${quote}><sourceFile>${sourceFile}</sourceFile><mutatedClass>${mutatedClass}</mutatedClass><mutatedMethod>&lt;init&gt;</mutatedMethod><methodDescription>()V</methodDescription><lineNumber>${line}</lineNumber><mutator>${mutator}</mutator><indexes><index>7</index></indexes><blocks><block>1</block></blocks><killingTest/><description>${description}</description></mutation>`

const sources = {
  'src/main/kotlin/acme/shop/Order.kt': 'package acme.shop\n\nclass Order\n',
  'src/main/kotlin/acme/Totals.kt': 'package acme.billing\n\ndata class Total(val sum: Int)\nobject Rounding\n\nfun round(x: Int) = x\n',
}
const read = (file) => sources[file]

test('pitest survivors are the mutants no test detected', () => {
  // Given a report with one survivor, one uncovered mutant, and two mutants a test detected
  const xml = report(
    mutation({ line: 12 }),
    mutation({ status: 'NO_COVERAGE', line: 20, mutator: 'org.pitest.mutationtest.engine.gregor.mutators.VoidMethodCallMutator', description: 'removed call to acme/shop/Log::write' }),
    mutation({ detected: 'true', status: 'KILLED', line: 30 }),
    mutation({ detected: 'true', status: 'TIMED_OUT', line: 31 })
  )

  // When the survivors are parsed
  const found = survivors(xml, Object.keys(sources), read)

  // Then only the two undetected mutants come back, each keyed to its source file and line
  assert.deepEqual(found, [
    { file: 'src/main/kotlin/acme/shop/Order.kt', line: 12, mutator: 'ConditionalsBoundary', replacement: 'changed conditional boundary', status: 'SURVIVED' },
    { file: 'src/main/kotlin/acme/shop/Order.kt', line: 20, mutator: 'VoidMethodCall', replacement: 'removed call to acme/shop/Log::write', status: 'NO_COVERAGE' },
  ])
})

test('a pitest survivor resolves to the scoped file whose package declares it, whatever its directory', () => {
  // Given a survivor in a file whose directory doesn't follow its package, with a nested class and an entity in the text
  const xml = report(mutation({ sourceFile: 'Totals.kt', mutatedClass: 'acme.billing.Total$Companion', line: 3, description: 'replaced Int return with 0 for acme/billing/Total::&lt;init&gt;' }))

  // When the survivors are parsed
  const [found] = survivors(xml, Object.keys(sources), read)

  // Then the file is the scoped one that declares that package, and the entity is decoded
  assert.equal(found.file, 'src/main/kotlin/acme/Totals.kt')
  assert.equal(found.replacement, 'replaced Int return with 0 for acme/billing/Total::<init>')
})

test('a pitest survivor outside the scoped files is named by its package path', () => {
  // Given a survivor in a class no scoped file declares, written with double-quoted attributes
  const xml = report(mutation({ sourceFile: 'Elsewhere.kt', mutatedClass: 'acme.other.Elsewhere', quote: '"' }))

  // When the survivors are parsed
  const [found] = survivors(xml, Object.keys(sources), read)

  // Then the file is the class's package path, so the row still says where to look
  assert.equal(found.file, 'acme/other/Elsewhere.kt')
})

test('a mutator with a variant suffix keeps the variant', () => {
  // Given a survivor from a mutator pitest names with a variant after the class name
  const xml = report(mutation({ mutator: 'org.pitest.mutationtest.engine.gregor.mutators.RemoveConditionalMutator_EQUAL_ELSE', description: 'removed conditional - replaced equality check with false' }))

  // When the survivors are parsed
  const [found] = survivors(xml, Object.keys(sources), read)

  // Then the mutator reads as the short name plus its variant
  assert.equal(found.mutator, 'RemoveConditional_EQUAL_ELSE')
})

test('pitest targets name each declared type, its nested types and the file facade', () => {
  // Given a scoped file declaring a data class and an object, in a package its directory doesn't follow
  const files = ['src/main/kotlin/acme/Totals.kt']

  // When the targets are computed
  const found = targets(files, read)

  // Then each type comes with its nested-type glob, and the facade covers the top-level function
  assert.deepEqual(found, ['acme.billing.Rounding', 'acme.billing.Rounding$*', 'acme.billing.Total', 'acme.billing.Total$*', 'acme.billing.TotalsKt'])
})

test('the pitest mutant count is every mutant in the report, detected or not', () => {
  // Given a report with a survivor and two detected mutants
  const xml = report(mutation({}), mutation({ detected: 'true', status: 'KILLED' }), mutation({ detected: 'true', status: 'TIMED_OUT' }))

  // When the mutants are counted
  const found = pack.mutation.mutants(xml)

  // Then all three count, and the enclosing <mutations> element doesn't
  assert.equal(found, 3)
})
