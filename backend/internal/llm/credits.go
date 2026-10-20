package llm

import "math"

// Billing rule, the only place it lives: the user pays BillMarkup x provider
// cost, one credit is USDPerCredit of that billed amount, rounded up per call.
const (
	BillMarkup   = 2.0
	USDPerCredit = 0.01
)

func Credits(costUSD float64) int {
	if costUSD <= 0 {
		return 0
	}
	return int(math.Ceil(costUSD*BillMarkup/USDPerCredit - 1e-9))
}

// Local backends run on our own hardware: no provider bill.
func IsLocal(backend string) bool {
	return backend == "ollama"
}
