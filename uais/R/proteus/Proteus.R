#loading in packages for manipulation and writing csv
library(tidyverse)
library(readr)

proteus <- read_csv("proteus.csv")

#dataset creation
dataset <- proteus %>%
  #filtering for bsaeball and non aa guests
  filter(sport == "baseball", `user name` != "AA GUEST") %>%
  #grouping by user, excerise and session. This is so we can see min low max per each exercise
  group_by(`user name`, `exercise id`, `exercise name`, `session id`, `birth date`, `session createdAt`) %>%  
  #creating our low high meanas
  summarise(
    # looking across every set of lows and gets the minimum of those lows
    across(ends_with(" - low"),  ~min(.x,  na.rm = TRUE), .names = "{.col}"),
    #looking across every high and gets the max of those highs
    across(ends_with(" - high"), ~max(.x,  na.rm = TRUE), .names = "{.col}"),
    #looking across every mean and gets the mean of those means
    across(ends_with(" - mean"), ~mean(.x, na.rm = TRUE), .names = "{.col}"),
    .groups = "drop"
  )

#writing csv file with the dataset
write_csv(dataset, "proteus_athlete_exercise_summary.csv")
