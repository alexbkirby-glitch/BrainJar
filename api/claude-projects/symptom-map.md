# Lodestone Symptom Vocabulary Map

Maps developer problem vocabulary to relevant seed IDs.
Use this as a pre-filter: identify the 5-10 seeds to read in detail from seeds.md.

**How to use:**
1. Find vocabulary terms that match what the developer described
2. Note the seed IDs listed under those terms
3. Look up those seeds in seeds.md for the full WRONG/CORRECT pattern

**"peeking"**
→ ab_peeking, optional_stopping_theorem_fair_games

**"looked"**
→ ab_peeking, screenshot_on_failure

**"celebrating"**
→ ab_no_primary_metric, stat_multiple_comparisons

**"lift"**
→ ab_novelty_effect, ab_sample_ratio_mismatch

**"disappeared"**
→ ab_novelty_effect, ds_missing_dead_letter_queue

**"reveals"**
→ ab_sample_ratio_mismatch, evolvability_capacitor_hidden_variation_stress_release

**"biases"**
→ ab_sample_ratio_mismatch, runaway_selection_positive_feedback_amplification

**"bounce"**
→ ab_guardrail_metrics_ignored, cta_label_destination_mismatch

**"retained"**
→ viewmodel_no_context, retention_compaction

**"cleared"**
→ viewmodel_no_context, isolate_module_mock

**"globalscope"**
→ coroutines_lifecycle_scope, kotlin_coroutine_scope

**"aware"**
→ stateflow_over_livedata, middleware_rate_limiting

**"powerful"**
→ stateflow_over_livedata, build_zig_configuration

**"singletons"**
→ hilt_dependency_injection, gdext_singleton_registration

**"foreground"**
→ workmanager_background_tasks, app_lifecycle_state

**"guaranteed"**
→ workmanager_background_tasks, db_natural_key_primary

**"highlights"**
→ jetpack_compose_recomposition, highlight_fields

**"recomposes" · "recomposition" · "composable"**
→ jetpack_compose_recomposition, compose_stable_types

**"death"**
→ navigation_component, react_error_boundary

**"preferences"**
→ datastore_over_shared_prefs, consent_dark_patterns

**"java"**
→ parcelable_over_serializable, kotlin_object_vs_companion

**"extensive"**
→ context_memory_leak, tw_burying_the_lede

**"releasing"**
→ proguard_missing_rules, go_defer_in_loop

**"certificate"**
→ network_security_config, ingress_tls_termination

**"trusting"**
→ network_security_config, kalman_filter_optimal_estimate_model_measurement

**"commenting"**
→ gradle_build_config, xfail_vs_skip

**"obs"**
→ async_pipe_not_subscribe, compound_meter_beat_division_not_six_beats

**"unsubscribe"**
→ async_pipe_not_subscribe, sharereplay_refcount

**"registries"**
→ standalone_components, docker_env_secrets

**"directive"**
→ standalone_components, analytics_loading_before_consent

**"flickers"**
→ trackby_ngfor, image_caching

**"shaking"**
→ injection_token_optional, gamedev_screen_shake

**"formcontrol"**
→ reactive_forms_typed, control_value_accessor

**"401"**
→ httpclient_interceptors, pf_not_maxing_tax_advantaged

**"safer"**
→ content_projection, kelly_criterion_resource_allocation

**"capable"**
→ content_projection, comparative_advantage_opportunity_cost

**"spinner"**
→ route_resolvers, finalize_cleanup

**"mounts"**
→ route_resolvers, docker_compose_override

**"intercepts"**
→ run_outside_angular, oauth_missing_pkce

**"editors"**
→ defer_block_lazy, htmx_events_javascript

**"idempotent"**
→ idempotency_required, select_for_update

**"plaintext"**
→ vault_for_secrets, sensitive_outputs

**"masked"**
→ block_rescue_always, thread_pool_sizing

**"yes"**
→ block_rescue_always, query_vs_filter_context

**"separation"**
→ inventory_group_vars, blueprint_organisation

**"jinja2"**
→ template_vs_copy, jinja2_filters

**"hosts"**
→ gather_facts_disable, session_security

**"gather"**
→ gather_facts_disable, async_flask_views

**"fact"**
→ gather_facts_disable, defer_resource_cleanup

**"provisioning"**
→ delegate_to_local, kelly_criterion_resource_allocation

**"targeting"**
→ delegate_to_local, coverage_branch

**"defaulting"**
→ jinja2_filters, regression_mse_vs_mae_loss_choice

**"timed"**
→ async_long_tasks, deadline_not_timeout

**"installs"**
→ async_long_tasks, standalone_output_mode

**"linting"**
→ lint_and_syntax_check, blame_ignore_revisions

**"mov"**
→ xor_zeroing_register, non_temporal_stores_streaming

**"encodes"**
→ xor_zeroing_register, href_javascript_scheme_injection

**"multiply"**
→ lea_for_arithmetic, tw_comment_restates_code

**"penalties"**
→ cmov_branch_elimination, pf_rsu_taxation_timing

**"perf"**
→ cmov_branch_elimination, non_temporal_stores_streaming

**"registers"**
→ calling_convention_callee_saved, db_soft_delete_everywhere

**"avx"**
→ stack_alignment_16byte, vzeroupper_avx_sse_penalty

**"callee"**
→ stack_alignment_16byte, sol_reentrancy_withdraw_before_state

**"movaps" · "vmovaps" · "aligned"**
→ stack_alignment_16byte, simd_data_alignment

**"unexplained" · "intel"**
→ vzeroupper_avx_sse_penalty, partial_register_stall

**"upper"**
→ vzeroupper_avx_sse_penalty, chord_inversion_vs_voicing

**"bits"**
→ vzeroupper_avx_sse_penalty, information_entropy_boltzmann_shannon

**"unaligned"**
→ simd_data_alignment, packed_struct_alignment

**"128"**
→ simd_data_alignment, integer_cache_equality

**"cores"**
→ cache_line_false_sharing, mixed_precision_training

**"dram"**
→ prefetch_instructions, nontemporal_vs_regular_loads

**"prefetching"**
→ prefetch_instructions, image_caching_fast_image

**"decodes"**
→ loop_alignment_nop, onclick_js_string_esc_bypass

**"solely"**
→ latency_vs_throughput, chord_inversion_vs_voicing

**"reciprocal"**
→ latency_vs_throughput, dependency_chain_breaking

**"memcpy"**
→ non_temporal_stores_streaming, c_missing_null_terminator

**"displaces"**
→ non_temporal_stores_streaming, syncopation_vs_hemiola

**"div"**
→ division_by_reciprocal, main_landmark_missing

**"ret"**
→ tail_call_jmp, cap_rate_compression_vs_noi_growth

**"minimise"**
→ nontemporal_vs_regular_loads, slim_vs_alpine_python

**"reused"**
→ nontemporal_vs_regular_loads, c_use_after_free

**"destination"**
→ bash_quote_variables, cta_label_destination_mismatch

**"subshell"**
→ bash_subshell_variable, bash_process_substitution

**"ifs"**
→ bash_array_iteration, ifs_contraction_mapping_attractor

**"temp"**
→ bash_trap_cleanup, bash_temp_files

**"whitespace"**
→ bash_heredoc, output_buffering_headers

**"cat"**
→ bash_read_while_file, session_secret_management

**"splits"**
→ bash_read_while_file, refine_existing_over_create_duplicate

**"forks"**
→ bash_string_manipulation, worker_concurrency_model

**"echo"**
→ bash_string_manipulation, execsync_shell_string_injection

**"limitations"**
→ bash_exit_codes, realtime_vs_firestore

**"overwritten"**
→ bash_readonly_constants, glsl_godot_canvas_modulate

**"mod"**
→ bash_function_return, availability_heuristic_incident_overrepresents_monitoring

**"tmp"**
→ bash_temp_files, session_security

**"predictable"**
→ bash_temp_files, ds_thundering_herd

**"sudden"**
→ phase_transition_sudden_system_collapse, pid_controller_three_terms_software_systems

**"incrementally"**
→ phase_transition_sudden_system_collapse, csharp_iasyncenumerable

**"assumptions"**
→ cascade_failure_criticality_propagation, st_mental_model_not_updated

**"optimistic"**
→ cascade_failure_criticality_propagation, optimistic_response

**"cascades"**
→ cascade_failure_criticality_propagation, radiation_requires_acceleration

**"provisioned" · "thrashes"**
→ fixed_point_iteration_convergence_failure, dissipative_feedback_stability_requirement

**"defensive"**
→ boundary_sensitivity_structural_instability, collections_prefer_immutable

**"corrects"**
→ dissipative_feedback_stability_requirement, runaway_selection_positive_feedback_amplification

**"amp"**
→ dissipative_feedback_stability_requirement, gradient_clipping_norm_vs_value

**"dissipative"**
→ dissipative_feedback_stability_requirement, liouville_theorem_phase_volume_preservation

**"compounding"**
→ ergodicity_failure_testing_production_mismatch, aggregation_pipeline_order

**"extended"**
→ ergodicity_failure_testing_production_mismatch, ir_no_incident_commander

**"converged"**
→ saddle_point_optimizer_false_convergence, nova_fixed_point_detection_c_nonzero

**"trains"**
→ saddle_point_optimizer_false_convergence, regression_mse_vs_mae_loss_choice

**"hyperparameter" · "solutions"**
→ saddle_point_optimizer_false_convergence, fitness_landscape_local_optima_trap

**"optimization"**
→ saddle_point_optimizer_false_convergence, power_law_few_dominate_many

**"emergency"**
→ mean_reversion_intervention_illusion, pf_emergency_fund_invested

**"perceived"**
→ power_law_few_dominate_many, innodb_default_engine

**"existed"**
→ universality_same_pattern_different_vocabulary, visual_regression

**"develop"**
→ entropy_accumulation_change_cost_growth, force_push_shared_branch

**"minimising"**
→ fitness_landscape_ml_flat_vs_sharp_minima, cross_entropy_decomposes_entropy_plus_kl

**"superior" · "displace" · "technically" · "established"**
→ ess_protocol_standard_lock_in, ess_stability_not_optimality

**"taken"**
→ ess_protocol_standard_lock_in, neg_positions_not_interests

**"agrees"**
→ ess_protocol_standard_lock_in, legal_verbal_contract_modification

**"hardening"**
→ red_queen_security_no_permanent_advantage, red_queen_arms_race_relative_fitness

**"combination"**
→ epistasis_feature_interaction_cannot_test_in_isolation, superposition_linear_system_decompose_analyse

**"segfault"**
→ c_buffer_overflow_strcpy, c_null_pointer_no_check

**"sprintf"**
→ c_buffer_overflow_strcpy, c_format_string_vulnerability

**"valgrind"**
→ c_use_after_free, c_uninitialized_variable

**"allocator"**
→ c_use_after_free, allocator_explicit_passing

**"printf"**
→ c_format_string_vulnerability, c_missing_null_terminator

**"uninitialized"**
→ c_uninitialized_variable, rails_zeitwerk_naming

**"optimizes"**
→ c_volatile_missing_mmio, neg_not_asking

**"hardware"**
→ c_volatile_missing_mmio, lumen_reflection_settings

**"optimized"**
→ c_volatile_missing_mmio, c_integer_overflow_c

**"qualifier"**
→ c_volatile_missing_mmio, cpp_auto

**"dereference"**
→ c_null_pointer_no_check, cpp_undefined_behaviour

**"fopen"**
→ c_null_pointer_no_check, emscripten_filesystem

**"dangling"**
→ c_return_stack_pointer, delegate_binding_unbinding

**"optimize"**
→ c_integer_overflow_c, st_goodharts_law

**"variadic"**
→ c_implicit_function_declaration, cpp_fold_expressions

**"prints"**
→ c_missing_null_terminator, python_logging_vs_print

**"filling"**
→ c_missing_null_terminator, fillna_strategies

**"dispatch" · "pickled" · "deserialised"**
→ pass_pk_not_model, pass_pk_not_instance

**"ahead"**
→ dedicated_queues_routing, red_queen_arms_race_relative_fitness

**"burst" · "starves"**
→ dedicated_queues_routing, task_routing_queues

**"reusable"**
→ shared_task_reusable, shared_task_django_apps

**"rapidly"**
→ result_backend_choice, st_stocks_flows_confused

**"countdown"**
→ task_retry_exponential, unity_time_scale

**"429"**
→ rate_limiting_tasks, llm_retry_exponential

**"dispatched"**
→ rate_limiting_tasks, signals_task_integration

**"continuing"**
→ revoke_running_tasks, sunk_cost_fallacy_past_investment_not_future_signal

**"revoke"**
→ revoke_running_tasks, oauth_refresh_token_no_rotation

**"deserialising"**
→ task_serializer_json, redis_wrong_data_structure

**"undetected"**
→ flower_monitoring, visual_regression

**"claimed"**
→ prefetch_multiplier, gibbard_satterthwaite_no_strategyproof_voting

**"reserved"**
→ prefetch_multiplier, pg_connection_limits

**"disappearing"**
→ task_failure_signals, threejs_frustum_culling

**"sentry"**
→ task_failure_signals, logging_configuration

**"experienced"**
→ working_memory_chunk_limit_api_surface, cognitive_tunneling_expert_fixation_misses_obvious

**"recurring"**
→ working_memory_chunk_limit_api_surface, fundamental_attribution_error_bugs_are_systemic

**"confirmation"**
→ dual_process_system1_dominates_under_load, desirability_bias_results_confirm_what_we_want

**"dialogs"**
→ dual_process_system1_dominates_under_load, platform_channels

**"stress"**
→ dual_process_system1_dominates_under_load, evolvability_capacitor_hidden_variation_stress_release

**"periods"**
→ dual_process_system1_dominates_under_load, tricorn_antiholomorphic_period_structure

**"say"**
→ dual_process_system1_dominates_under_load, tw_commit_message_vague

**"deliberate"**
→ dual_process_system1_dominates_under_load, dunbar_number_communication_overhead_phase_transition

**"happy"**
→ confirmation_bias_testing_confirming_cases, error_union_try

**"mortem"**
→ availability_heuristic_incident_overrepresents_monitoring, hindsight_bias_postmortem_outcome_known_distorts

**"suspiciously"**
→ anchoring_first_estimate_distorts_all_subsequent, benford_law_first_digit_distribution

**"anchoring"**
→ anchoring_first_estimate_distorts_all_subsequent, neg_first_offer_too_conservative

**"sprint"**
→ anchoring_first_estimate_distorts_all_subsequent, coverage_thresholds

**"dead"**
→ sunk_cost_fallacy_past_investment_not_future_signal, ds_missing_dead_letter_queue

**"license"**
→ sunk_cost_fallacy_past_investment_not_future_signal, legal_open_source_license_gpl

**"determines"**
→ sunk_cost_fallacy_past_investment_not_future_signal, comparative_advantage_opportunity_cost

**"technology"**
→ sunk_cost_fallacy_past_investment_not_future_signal, adaptive_radiation_burst_after_niche_opening

**"invest"**
→ sunk_cost_fallacy_past_investment_not_future_signal, pf_not_maxing_tax_advantaged

**"communications" · "resistance" · "removals"**
→ loss_aversion_feature_removal_disproportionate_resistance, framing_gains_vs_losses_same_information

**"replacement"**
→ loss_aversion_feature_removal_disproportionate_resistance, 1031_exchange_strict_timeline_45_180

**"barely"**
→ loss_aversion_feature_removal_disproportionate_resistance, red_queen_arms_race_relative_fitness

**"concentrated"**
→ loss_aversion_feature_removal_disproportionate_resistance, pf_employer_stock_concentration

**"removal"**
→ loss_aversion_feature_removal_disproportionate_resistance, pq_expand_all_columns

**"launch"**
→ hyperbolic_discounting_technical_debt_always_later, cuda_synchronize_timing

**"backlog"**
→ hyperbolic_discounting_technical_debt_always_later, mullers_ratchet_irreversible_defect_accumulation

**"affected"**
→ scope_insensitivity_impact_not_perceived_linearly, sql_delete_without_where

**"crosses"**
→ scope_insensitivity_impact_not_perceived_linearly, confidence_loop_is_closed_knot

**"presenting"**
→ scope_insensitivity_impact_not_perceived_linearly, framing_gains_vs_losses_same_information

**"productivity"**
→ attention_residue_context_switching_deep_work, comparative_advantage_opportunity_cost

**"banners"**
→ change_blindness_users_miss_obvious_interface_changes, consent_dark_patterns

**"climbs"**
→ social_proof_herding_metrics_become_targets, go_goroutine_leak

**"publicly"**
→ social_proof_herding_metrics_become_targets, csharp_lock_object_pattern

**"desired"**
→ framing_gains_vs_losses_same_information, gradient_accumulation

**"obviously"**
→ hindsight_bias_postmortem_outcome_known_distorts, ess_stability_not_optimality

**"recur"**
→ hindsight_bias_postmortem_outcome_known_distorts, ir_no_monitoring_after_fix

**"formal"**
→ dunbar_number_communication_overhead_phase_transition, anytype_function_parameters

**"organisations"**
→ dunbar_number_communication_overhead_phase_transition, analytics_loading_before_consent

**"restructuring"**
→ dunbar_number_communication_overhead_phase_transition, genetic_drift_population_bottleneck_capacity_loss

**"expert"**
→ cognitive_tunneling_expert_fixation_misses_obvious, pe_vague_role_context

**"expertise"**
→ cognitive_tunneling_expert_fixation_misses_obvious, genetic_drift_population_bottleneck_capacity_loss

**"experiments"**
→ desirability_bias_results_confirm_what_we_want, firebase_emulator_local_dev

**"probing"**
→ desirability_bias_results_confirm_what_we_want, actuator_health_docker

**"studies"**
→ desirability_bias_results_confirm_what_we_want, stat_survivorship_bias

**"limiter" · "quite"**
→ pid_controller_three_terms_software_systems, software_feedback_pid_identification_template

**"permissive"**
→ pid_controller_three_terms_software_systems, cors_configuration

**"reacts"**
→ pid_controller_three_terms_software_systems, kalman_filter_optimal_estimate_model_measurement

**"gradual"**
→ pid_controller_three_terms_software_systems, index_lifecycle_management

**"overshoots"**
→ pid_controller_three_terms_software_systems, st_linear_thinking_delays

**"tweaking"**
→ pid_controller_three_terms_software_systems, threejs_dat_gui_debug

**"therefore"**
→ pid_controller_three_terms_software_systems, functor_category_objects_are_functors

**"utilisation"**
→ pid_proportional_only_steady_state_error, dataloader_workers_pinmemory

**"arrive"**
→ pid_integral_windup_saturation_overshoot, switchmap_cancels_previous

**"unfiltered"**
→ pid_derivative_measurement_noise_amplification, bool_query_structure

**"trial"**
→ ziegler_nichols_step_response_systematic_tuning, tw_api_docs_no_examples

**"graphs"**
→ nyquist_sampling_monitoring_undersampling_aliasing, blueprint_vs_cpp_split

**"detecting"**
→ nyquist_sampling_monitoring_undersampling_aliasing, latent_heat_phase_transition_energy_flow

**"smoothed"**
→ exponential_moving_average_lowpass_phase_lag, label_smoothing_calibration_tradeoff

**"bimodal"**
→ aliasing_aggregated_metrics_hide_distribution, viz_average_without_distribution

**"aggregating"**
→ aliasing_aggregated_metrics_hide_distribution, arrayagg_stringagg

**"150"**
→ bode_plot_gain_crossover_phase_margin, connection_pool_sizing

**"quantifying"**
→ bode_plot_gain_crossover_phase_margin, depreciation_recapture_separate_from_capgains

**"amplitude"**
→ limit_cycle_nonlinear_distinct_from_transient, wavefunction_amplitude_not_probability

**"corrective"**
→ negative_feedback_sign_error_positive_runaway, title_is_correction_not_bug_name

**"rings"**
→ transfer_function_poles_stability_time_response, mandelbrot_smooth_coloring_log_formula

**"poles" · "plane"**
→ transfer_function_poles_stability_time_response, z_transform_discrete_stability_unit_circle

**"scheme"**
→ shannon_channel_capacity_fundamental_limit, redirect_301_to_https

**"addressing"**
→ shannon_channel_capacity_fundamental_limit, wrong_correct_scope_must_match

**"steady"**
→ cascade_control_inner_outer_loop_timescale, software_feedback_pid_identification_template

**"cont"**
→ cascade_control_inner_outer_loop_timescale, extension_check_insufficient_path_guard

**"distinct"**
→ cascade_control_inner_outer_loop_timescale, sql_union_vs_union_all

**"overshoot"**
→ software_feedback_pid_identification_template, gibbs_phenomenon_fourier_series

**"diversity"**
→ software_feedback_pid_identification_template, westinghouse_loop_closure

**"simulating"**
→ superposition_linear_system_decompose_analyse, liouville_theorem_phase_volume_preservation

**"practice"**
→ z_transform_discrete_stability_unit_circle, st_goodharts_law

**"euler"**
→ z_transform_discrete_stability_unit_circle, stiff_ode_explicit_solver_failure

**"redesign"**
→ observer_separation_principle_control_estimation, punctuated_equilibrium_stasis_then_rapid_change

**"literals"**
→ cpp_string_view, threejs_custom_shader_glsl

**"linker"**
→ cpp_include_guards, gdext_scons_build

**"constrain"**
→ cpp_concepts, ts_generic_constraint

**"bool"**
→ cpp_optional_usage, csharp_value_type_boxing

**"pollute"**
→ cpp_optional_usage, spy_on_not_reassign

**"visit"**
→ cpp_variant_visit, hsts_header_missing

**"pack"**
→ cpp_fold_expressions, wasm_pack_bundler_integration

**"destruction"**
→ cpp_jthread_stop_token, svelte_store_subscribe

**"clearer"**
→ cpp_structured_bindings_advanced, collections_over_arrays

**"macro"**
→ cpp_modules, elixir_macro_hygiene

**"awaiting"**
→ csharp_configureawait, csharp_godot_tween_await

**"idisposable" · "httpclient"**
→ csharp_idisposable, csharp_dispose_pattern

**"enumerated"**
→ csharp_linq_deferred, enum_backed_types

**"invalidcastexception"**
→ csharp_pattern_matching, csharp_get_node_generic

**"mytype"**
→ csharp_pattern_matching, ts_assertion_vs_narrowing

**"buffered"**
→ csharp_iasyncenumerable, pythonunbuffered_logs

**"initializer"**
→ csharp_required_members, sol_constructor_vs_initializer

**"typeof"**
→ csharp_lock_object_pattern, ts_runtime_type_check

**"myclass"**
→ csharp_lock_object_pattern, first_class_callables

**"serialization"**
→ csharp_source_generators, circular_reference_serialize

**"aot"**
→ csharp_source_generators, hermes_engine

**"relies"**
→ csharp_source_generators, sitemap_missing_or_unsubmitted

**"flushing"**
→ csharp_dispose_async, buffer_window_operators

**"styling"**
→ specificity_id_overuse, pseudo_element_content

**"nav"**
→ specificity_id_overuse, selector_performance

**"escalating"**
→ specificity_id_overuse, gamedev_feedback_loops

**"wars" · "specificity"**
→ specificity_id_overuse, cascade_layers

**"margins"**
→ margin_collapsing, gap_vs_margin_grid

**"20px"**
→ margin_collapsing, touch_targets_too_small

**"absolutely" · "positioned"**
→ absolute_positioning_parent, overflow_hidden_clipping

**"anchored"**
→ absolute_positioning_parent, neg_first_offer_too_conservative

**"distant"**
→ absolute_positioning_parent, world_partition_hlod

**"nearest"**
→ absolute_positioning_parent, curse_of_dimensionality_distance

**"border"**
→ box_sizing_border_box, logical_properties_rtl

**"thin"**
→ grid_implicit_tracks, thin_product_pages_no_copy

**"sized"**
→ grid_implicit_tracks, container_queries

**"chrome"**
→ transform_performance, font_display_swap_missing

**"pseudo"**
→ pseudo_element_content, chebyshev_basis_better_conditioned

**"menus"**
→ overflow_hidden_clipping, mobile_viewport_emulation

**"floats"**
→ overflow_hidden_clipping, dtype_optimisation

**"misaligned"**
→ logical_properties_rtl, signaling_costly_signals_credibility

**"asymmetric"**
→ logical_properties_rtl, kl_divergence_asymmetry_direction

**"jarring"**
→ clamp_fluid_typography, images_missing_width_height

**"breakpoints"**
→ clamp_fluid_typography, run_in_band_debugging

**"responsive"**
→ clamp_fluid_typography, mobile_viewport_emulation

**"hover"**
→ selector_performance, preload_extension

**"sidebar"**
→ selector_performance, container_queries

**"fighting"**
→ cascade_layers, threejs_camera_near_far

**"respect"**
→ gap_vs_margin_grid, highlight_fields

**"bigger"**
→ viz_truncated_y_axis, viz_choropleth_raw_counts

**"misleading"**
→ viz_truncated_y_axis, universal_seed_is_stack_agnostic

**"cream" · "drowning" · "deaths" · "correlate" · "ice"**
→ viz_dual_y_axis_spurious, stat_correlation_not_causation

**"proportions"**
→ viz_pie_chart_overuse, value_counts_normalize

**"accurately"**
→ viz_pie_chart_overuse, status_codes_not_http

**"judge"**
→ viz_pie_chart_overuse, viz_missing_context

**"sorted"**
→ viz_unsorted_bar_chart, redis_wrong_data_structure

**"performer"**
→ viz_unsorted_bar_chart, concert_pitch_vs_written_pitch_transposing_instruments

**"insight"**
→ viz_unsorted_bar_chart, viz_chartjunk

**"satisfaction"**
→ viz_average_without_distribution, pe_over_constraining

**"outliers"**
→ viz_average_without_distribution, regression_mse_vs_mae_loss_choice

**"blind"**
→ viz_color_not_accessible, threejs_stats_monitor

**"countries"**
→ viz_overloaded_chart, stat_ecological_fallacy

**"spaghetti"**
→ viz_overloaded_chart, blueprint_vs_cpp_split

**"idea"**
→ viz_missing_context, stash_named

**"kpi"**
→ viz_missing_context, st_goodharts_law

**"bars"**
→ viz_chartjunk, syncopation_vs_hemiola

**"decoration"**
→ viz_chartjunk, sized_box_over_container

**"decorative"**
→ viz_chartjunk, westinghouse_loop_closure

**"shadows"**
→ viz_chartjunk, threejs_shadow_performance

**"backgrounds"**
→ viz_chartjunk, app_lifecycle_state
