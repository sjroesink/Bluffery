package main

import (
	"strings"
	"testing"
)

// Sander requested an expansion, not a replacement or a padded 200-card ceiling.
func TestProductionCatalogHasMoreThanTwoHundredQuestions(t *testing.T) {
	questions, err := loadCatalog(false)
	if err != nil {
		t.Fatal(err)
	}
	if len(questions) <= 200 {
		t.Fatalf("need more than 200 approved questions, got %d", len(questions))
	}
	for _, question := range questions {
		if strings.Contains(strings.ToLower(question.Answer), "helium") && strings.Contains(strings.ToLower(question.Question), "alligator") {
			t.Fatalf("explicitly rejected, easily guessed helium question is active: %s", question.ID)
		}
	}
}
